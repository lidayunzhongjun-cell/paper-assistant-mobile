package org.paperassistant.mobile;
import org.json.*;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class TranslationProtocol {
  static final class Request {
    String endpoint, body, contentType;
    final Map<String,String> headers=new LinkedHashMap<>();
  }
  static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
  static String hash(String algorithm,String value)throws Exception{return hex(MessageDigest.getInstance(algorithm).digest(value.getBytes(StandardCharsets.UTF_8)));}
  static byte[] hmac(byte[] key,String text)throws Exception{Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(key,"HmacSHA256"));return mac.doFinal(text.getBytes(StandardCharsets.UTF_8));}
  static String input(String text){int n=text.codePointCount(0,text.length());return n<=20?text:text.substring(0,text.offsetByCodePoints(0,10))+n+text.substring(text.offsetByCodePoints(0,n-10));}
  static String lang(String provider,String value){if(provider.equals("youdao")&&value.equals("zh"))return "zh-CHS";if(provider.equals("baidu")){if(value.equals("ja"))return "jp";if(value.equals("fr"))return "fra";}return value;}
  static String form(Map<String,String> fields)throws Exception{StringBuilder out=new StringBuilder();for(Map.Entry<String,String> e:fields.entrySet()){if(out.length()>0)out.append('&');out.append(URLEncoder.encode(e.getKey(),"UTF-8")).append('=').append(URLEncoder.encode(e.getValue(),"UTF-8"));}return out.toString();}
  static Request build(String provider,String text,String from,String to,JSONObject config,long time,String salt)throws Exception{
    String id=config.optString(provider+"IdKey"),key=config.optString(provider+"Key");
    if(id.isEmpty()||key.isEmpty())throw new IOException("请在翻译设置中填写该服务的 ID 和密钥");
    Request r=new Request();
    if(provider.equals("tencent")){
      r.endpoint="https://tmt.tencentcloudapi.com/";r.contentType="application/json; charset=utf-8";
      r.body=new JSONObject().put("SourceText",text).put("Source",from).put("Target",to).put("ProjectId",0).toString();
      SimpleDateFormat fmt=new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT);fmt.setTimeZone(TimeZone.getTimeZone("UTC"));String date=fmt.format(new Date(time*1000)),scope=date+"/tmt/tc3_request";
      String canonical="POST\n/\n\ncontent-type:"+r.contentType+"\nhost:tmt.tencentcloudapi.com\n\ncontent-type;host\n"+hash("SHA-256",r.body);
      String toSign="TC3-HMAC-SHA256\n"+time+"\n"+scope+"\n"+hash("SHA-256",canonical);
      byte[] signing=hmac(hmac(hmac(("TC3"+key).getBytes(StandardCharsets.UTF_8),date),"tmt"),"tc3_request");
      r.headers.put("Authorization","TC3-HMAC-SHA256 Credential="+id+"/"+scope+", SignedHeaders=content-type;host, Signature="+hex(hmac(signing,toSign)));
      r.headers.put("X-TC-Action","TextTranslate");r.headers.put("X-TC-Version","2018-03-21");r.headers.put("X-TC-Timestamp",String.valueOf(time));r.headers.put("X-TC-Region",config.optString("tencentRegion","ap-guangzhou"));
    }else{
      r.contentType="application/x-www-form-urlencoded; charset=utf-8";Map<String,String> fields=new LinkedHashMap<>();fields.put("q",text);fields.put("from",lang(provider,from));fields.put("to",lang(provider,to));fields.put("salt",salt);
      if(provider.equals("youdao")){r.endpoint="https://openapi.youdao.com/api";fields.put("appKey",id);fields.put("signType","v3");fields.put("curtime",String.valueOf(time));fields.put("strict","true");fields.put("sign",hash("SHA-256",id+input(text)+salt+time+key));}
      else if(provider.equals("baidu")){r.endpoint="https://fanyi-api.baidu.com/api/trans/vip/translate";fields.put("appid",id);fields.put("sign",hash("MD5",id+text+salt+key));}
      else throw new IOException("未知翻译服务");
      r.body=form(fields);
    }
    return r;
  }
  static String result(String provider,JSONObject data)throws Exception{
    String code=provider.equals("youdao")?data.optString("errorCode"):provider.equals("baidu")?data.optString("error_code"):"";
    if(provider.equals("tencent")){data=data.getJSONObject("Response");if(data.has("Error"))code=data.getJSONObject("Error").optString("Code","Unknown");else return data.getString("TargetText");}
    if(!code.isEmpty()&&!code.equals("0")&&!code.equals("52000"))throw new IOException("翻译服务错误 "+(code.matches("[A-Za-z0-9_.]{1,80}")?code:"Unknown")+"，请检查密钥、服务开通状态或额度");
    JSONArray rows=data.getJSONArray(provider.equals("youdao")?"translation":"trans_result");StringBuilder out=new StringBuilder();
    for(int i=0;i<rows.length();i++){if(i>0)out.append('\n');out.append(provider.equals("youdao")?rows.getString(i):rows.getJSONObject(i).getString("dst"));}return out.toString();
  }
}
