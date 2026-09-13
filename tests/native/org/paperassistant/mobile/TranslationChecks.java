package org.paperassistant.mobile;
import org.json.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import com.translated.lara.translator.TranslateOptions;
import com.translated.lara.translator.TranslationStyle;
import com.translated.lara.translator.Translator;
import com.translated.lara.authentication.AccessKey;
public final class TranslationChecks {
  static void check(boolean b){if(!b)throw new AssertionError("Translation protocol regression");}
  public static void main(String[] args)throws Exception{
    JSONObject config=new JSONObject();for(String p:new String[]{"youdao","baidu","tencent"})config.put(p+"IdKey","fixture-id").put(p+"Key","fixture-secret");
    JSONArray vectors=new JSONArray();String text="研究 α & β = 42. Conditions matter. 😀";
    for(String p:new String[]{"youdao","baidu","tencent"}){
      TranslationProtocol.Request r=TranslationProtocol.build(p,text,"ja","zh",config,1700000000L,"fixture-salt");
      check(r.endpoint.startsWith("https://"));check(!r.body.contains("fixture-secret"));
      vectors.put(new JSONObject().put("provider",p).put("body",r.body).put("type",r.contentType).put("headers",r.headers).put("text",text));
    }
    check(TranslationProtocol.lang("baidu","ja").equals("jp"));check(TranslationProtocol.lang("baidu","fr").equals("fra"));check(TranslationProtocol.lang("youdao","zh").equals("zh-CHS"));
    check(TranslationProtocol.result("youdao",new JSONObject("{\"errorCode\":\"0\",\"translation\":[\"第一段\",\"第二段\"]}")).equals("第一段\n第二段"));
    check(TranslationProtocol.result("baidu",new JSONObject("{\"trans_result\":[{\"dst\":\"结果\"}]}")).equals("结果"));
    check(TranslationProtocol.result("tencent",new JSONObject("{\"Response\":{\"TargetText\":\"结果\"}}")).equals("结果"));
    TranslateOptions lara=LaraSupport.options();
    check(Boolean.TRUE.equals(lara.getNoTrace()));check("text/plain".equals(lara.getContentType()));check(lara.getStyle()==TranslationStyle.FAITHFUL);check(lara.getTimeoutMs()==45000L);
    check(LaraSupport.language("auto")==null);check("zh".equals(LaraSupport.language("zh")));
    check(new Translator(new AccessKey("fixture-id","fixture-secret"))!=null);
    try{new LaraSupport().translate("test","en","zh","","");throw new AssertionError("Missing Lara keys accepted");}catch(java.io.IOException expected){check(expected.getMessage().contains("Lara"));}
    for(String p:new String[]{"youdao","baidu","tencent"}){
      try{TranslationProtocol.build(p,text,"en","zh",new JSONObject(),1700000000,"salt");throw new AssertionError("Missing keys accepted");}catch(java.io.IOException expected){}
      JSONObject error=p.equals("tencent")?new JSONObject("{\"Response\":{\"Error\":{\"Code\":\"AuthFailure\",\"Message\":\"fixture-secret\"}}}"):new JSONObject().put(p.equals("youdao")?"errorCode":"error_code","54001");
      try{TranslationProtocol.result(p,error);throw new AssertionError("Service error accepted");}catch(java.io.IOException expected){check(!expected.getMessage().contains("fixture-secret"));}
    }
    Files.write(Paths.get(args[0],"translation-vectors.json"),vectors.toString().getBytes(StandardCharsets.UTF_8));
    System.out.println("Translation response, language mapping, missing credential and error handling checks passed.");
  }
}
