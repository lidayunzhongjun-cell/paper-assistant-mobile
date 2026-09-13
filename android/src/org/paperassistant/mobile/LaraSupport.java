package org.paperassistant.mobile;

import com.translated.lara.authentication.AccessKey;
import com.translated.lara.errors.LaraApiConnectionException;
import com.translated.lara.errors.LaraApiConnectionTimeoutException;
import com.translated.lara.errors.LaraApiException;
import com.translated.lara.errors.LaraException;
import com.translated.lara.net.ClientOptions;
import com.translated.lara.translator.TextResult;
import com.translated.lara.translator.TranslateOptions;
import com.translated.lara.translator.TranslationStyle;
import com.translated.lara.translator.Translator;
import java.io.IOException;

final class LaraSupport {
  private static final class Client {
    final String id, secret;
    final Translator translator;
    Client(String id,String secret){
      this.id=id;this.secret=secret;
      ClientOptions network=new ClientOptions().setConnectionTimeoutMs(15000).setReadTimeoutMs(60000);
      translator=new Translator(new AccessKey(id,secret),network);
    }
  }
  private volatile Client client;

  void reset(){client=null;}
  private Client client(String id,String secret){
    Client current=client;
    if(current!=null&&current.id.equals(id)&&current.secret.equals(secret))return current;
    synchronized(this){
      current=client;
      if(current==null||!current.id.equals(id)||!current.secret.equals(secret))client=current=new Client(id,secret);
      return current;
    }
  }
  static String language(String value){return "auto".equals(value)?null:value;}
  static TranslateOptions options(){
    return new TranslateOptions().setNoTrace(true).setContentType("text/plain").setStyle(TranslationStyle.FAITHFUL).setTimeoutMs(45000);
  }
  synchronized String translate(String text,String source,String target,String id,String secret)throws IOException {
    if(id.isEmpty()||secret.isEmpty())throw new IOException("请先在翻译设置中填写 Lara Access Key ID 和 Secret");
    if(Thread.currentThread().isInterrupted())throw new IOException("已停止翻译");
    try {
      TextResult response=client(id,secret).translator.translate(text,language(source),language(target),options());
      if(Thread.currentThread().isInterrupted())throw new IOException("已停止翻译");
      return response==null?null:response.getTranslation();
    } catch(LaraApiConnectionTimeoutException|com.translated.lara.errors.TimeoutException e){
      throw new IOException("Lara 翻译超时，请重试");
    } catch(LaraApiException e){
      int code=e.getStatusCode();
      if(code==401||code==403)throw new IOException("Lara 鉴权失败，请检查 Access Key ID 和 Secret");
      if(code==429)throw new IOException("Lara 请求过多或额度不足，请稍后重试");
      if(code==400||code==422)throw new IOException("Lara 不接受当前文字或语言组合，请调整后重试");
      throw new IOException("Lara 翻译服务返回 HTTP "+code+"，请稍后重试");
    } catch(LaraApiConnectionException e){
      throw new IOException("无法连接 Lara 翻译服务，请检查网络和手机时间");
    } catch(LaraException e){
      throw new IOException("Lara 翻译失败，请检查服务开通状态或额度");
    }
  }
}
