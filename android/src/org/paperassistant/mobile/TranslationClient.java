package org.paperassistant.mobile;
import android.content.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

final class TranslationClient {
  private final Context context; private final ModelClient model;
  private final LaraSupport lara=new LaraSupport();
  private final Map<String,HttpURLConnection> connections=new ConcurrentHashMap<>();
  private final Map<String,Thread> laraThreads=new ConcurrentHashMap<>();
  private final Set<String> cancelled=ConcurrentHashMap.newKeySet();
  TranslationClient(Context context,ModelClient model){this.context=context;this.model=model;}
  void cancel(String id){cancelled.add(id);HttpURLConnection c=connections.get(id);if(c!=null)c.disconnect();Thread t=laraThreads.get(id);if(t!=null)t.interrupt();}
  void close(){for(String id:connections.keySet())cancel(id);for(String id:laraThreads.keySet())cancel(id);lara.reset();}
  synchronized JSONObject config(boolean secret)throws Exception {
    SharedPreferences p=context.getSharedPreferences("translation",Context.MODE_PRIVATE);
    JSONObject c=new JSONObject().put("libreEndpoint",p.getString("libreEndpoint","https://libretranslate.com"));
    for(String service:new String[]{"deepl","libre","youdao","youdaoId","baidu","baiduId","tencent","tencentId","lara","laraId"}){String key=p.getString(service,"");c.put(service+"HasKey",!key.isEmpty());if(secret)c.put(service+"Key",key.isEmpty()?"":model.decrypt(key));}c.put("tencentRegion",p.getString("tencentRegion","ap-guangzhou"));return c;
  }
  synchronized void save(JSONObject data)throws Exception {
    String endpoint=data.optString("libreEndpoint","https://libretranslate.com").trim();if(url(endpoint).getQuery()!=null)throw new IOException("翻译地址不能带查询参数，密钥请填写到密钥栏");
    SharedPreferences.Editor editor=context.getSharedPreferences("translation",Context.MODE_PRIVATE).edit().putString("libreEndpoint",endpoint);
    for(String service:new String[]{"deepl","libre","youdao","youdaoId","baidu","baiduId","tencent","tencentId","lara","laraId"}){String key=data.optString(service+"Key").trim();if(service.endsWith("Id")&&!key.isEmpty()&&!key.matches("[A-Za-z0-9_-]{1,256}"))throw new IOException("翻译应用 ID 格式不正确");if(key.length()>8192)throw new IOException("翻译密钥过长");if(data.optBoolean(service.replace("Id","")+"Clear"))editor.remove(service);else if(!key.isEmpty())editor.putString(service,model.encrypt(key));}
    String region=data.optString("tencentRegion","ap-guangzhou").trim();if(!region.matches("[a-z]+-[a-z]+(?:-[0-9]+)?"))throw new IOException("腾讯云地域格式不正确");editor.putString("tencentRegion",region);
    if(!editor.commit())throw new IOException("翻译设置保存失败");lara.reset();
  }
  private URL url(String value)throws Exception {URL u=new URL(value);if(!Arrays.asList("https","http").contains(u.getProtocol())||u.getHost().isEmpty()||u.getUserInfo()!=null||u.getRef()!=null||value.length()>6000)throw new IOException("翻译地址不合法");return u;}
  private JSONObject request(String id,String endpoint,JSONObject body,String auth)throws Exception {
    Map<String,String> headers=new HashMap<>();if(auth!=null)headers.put("Authorization",auth);
    return requestRaw(id,endpoint,body==null?null:body.toString(),"application/json",headers);
  }
  private JSONObject requestRaw(String id,String endpoint,String body,String contentType,Map<String,String> headers)throws Exception {
    HttpURLConnection c=(HttpURLConnection)url(endpoint).openConnection();connections.put(id,c);
    try {if(cancelled.contains(id))throw new IOException("已停止翻译");c.setConnectTimeout(15000);c.setReadTimeout(30000);c.setInstanceFollowRedirects(false);
      for(Map.Entry<String,String> header:headers.entrySet())c.setRequestProperty(header.getKey(),header.getValue());
      if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type",contentType);byte[] bytes=body.getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=c.getOutputStream()){out.write(bytes);}}
      int code=c.getResponseCode();if(code<200||code>=300)throw new IOException("翻译服务返回 HTTP "+code+"，可检查服务设置或改用 AI 翻译");
      try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){if(cancelled.contains(id))throw new IOException("已停止翻译");out.write(buf,0,n);if(out.size()>1000000)throw new IOException("翻译返回过大");}return new JSONObject(out.toString("UTF-8"));}
    } finally {connections.remove(id);c.disconnect();}
  }
  private final Map<String,Long> nextRequest=new HashMap<>();
  private void pace(String id,String provider)throws Exception{
    long start; synchronized(nextRequest){long now=System.currentTimeMillis();start=Math.max(now,nextRequest.containsKey(provider)?nextRequest.get(provider):now);nextRequest.put(provider,start+1100);}
    while(System.currentTimeMillis()<start){if(cancelled.contains(id))throw new IOException("已停止翻译");Thread.sleep(Math.max(1,Math.min(50,start-System.currentTimeMillis()+1)));}
  }
  JSONObject translate(String id,JSONObject data)throws Exception {
    try {String text=data.getString("text"),provider=data.getString("provider"),source=data.getString("source"),target=data.getString("target");
      if(text.trim().isEmpty()||text.length()>18000||!source.matches("auto|en|zh|ja|de|fr")||!target.matches("en|zh|ja|de|fr"))throw new IOException("选文或翻译语言不合法");
      JSONObject c=config(true);String result;
      if(Arrays.asList("youdao","baidu","tencent").contains(provider)){
        if(text.getBytes(StandardCharsets.UTF_8).length>1800)throw new IOException("翻译分段超过服务限制");
        pace(id,provider);
        TranslationProtocol.Request r=TranslationProtocol.build(provider,text,source,target,c,System.currentTimeMillis()/1000,UUID.randomUUID().toString());
        result=TranslationProtocol.result(provider,requestRaw(id,r.endpoint,r.body,r.contentType,r.headers));
      } else if(provider.equals("lara")){
        laraThreads.put(id,Thread.currentThread());
        try {result=lara.translate(text,source,target,c.getString("laraIdKey"),c.getString("laraKey"));}
        finally {laraThreads.remove(id);}
      } else if(provider.equals("mymemory")){
        if(source.equals("auto"))throw new IOException("MyMemory 需要指定原文语言，请选择英语等语言");
        if(text.getBytes(StandardCharsets.UTF_8).length>480)throw new IOException("翻译分段超过服务限制");
        JSONObject response=request(id,"https://api.mymemory.translated.net/get?q="+URLEncoder.encode(text,"UTF-8")+"&langpair="+URLEncoder.encode(source+"|"+target,"UTF-8"),null,null);
        if(response.optInt("responseStatus")!=200)throw new IOException("MyMemory 暂不可用或额度已用完，可改用其他服务或 AI 翻译");result=response.getJSONObject("responseData").getString("translatedText");
      } else if(provider.equals("deepl-free")||provider.equals("deepl-pro")){
        String key=c.getString("deeplKey");if(key.isEmpty())throw new IOException("请先在设置中保存 DeepL API Key，或改用 AI 翻译");
        JSONObject body=new JSONObject().put("text",new JSONArray().put(text)).put("target_lang",target.toUpperCase(Locale.ROOT));if(!source.equals("auto"))body.put("source_lang",source.toUpperCase(Locale.ROOT));
        result=request(id,provider.equals("deepl-free")?"https://api-free.deepl.com/v2/translate":"https://api.deepl.com/v2/translate",body,"DeepL-Auth-Key "+key).getJSONArray("translations").getJSONObject(0).getString("text");
      } else if(provider.equals("libre")){
        String endpoint=c.getString("libreEndpoint").replaceAll("/+$","");if(!endpoint.endsWith("/translate"))endpoint+="/translate";
        JSONObject body=new JSONObject().put("q",text).put("source",source).put("target",target).put("format","text");if(!c.getString("libreKey").isEmpty())body.put("api_key",c.getString("libreKey"));
        result=request(id,endpoint,body,null).getString("translatedText");
      } else throw new IOException("未知翻译服务");
      if(result.trim().isEmpty())throw new IOException("翻译服务返回空内容");return new JSONObject().put("text",result);
    }finally{cancelled.remove(id);}
  }
}
