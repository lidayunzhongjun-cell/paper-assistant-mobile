package org.paperassistant.mobile;

import android.app.*;
import android.os.*;
import android.content.*;
import android.net.Uri;
import android.graphics.Color;
import android.view.*;
import android.webkit.*;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class ModelClient {
  private final Context context;
  private final Map<String, HttpURLConnection> connections = new ConcurrentHashMap<>();
  private final Set<String> cancelled = ConcurrentHashMap.newKeySet();
  ModelClient(Context context) { this.context = context.getApplicationContext(); }
  void cancel(String id) { cancelled.add(id); HttpURLConnection conn = connections.get(id); if (conn != null) conn.disconnect(); }
  void close() { for (String id : connections.keySet()) cancel(id); }
  static String safeMessage(Exception e) {
    if (e instanceof SocketTimeoutException) return "模型请求超时，请重试";
    if (e instanceof javax.net.ssl.SSLException) return "HTTPS 连接失败，请检查证书和手机时间";
    if (e instanceof UnknownHostException || e instanceof ConnectException) return "无法连接模型服务，请检查网络与 API 地址";
    if (e instanceof JSONException) return "数据格式异常，原文件已保留";
    return e instanceof IOException && e.getMessage() != null && e.getMessage().matches("[\\s\\S]*[\\u4e00-\\u9fff][\\s\\S]*") ? e.getMessage() : "操作失败，请重试；原文件已保留";
  }
  synchronized JSONObject config(boolean secret) throws Exception {
    android.content.SharedPreferences prefs = context.getSharedPreferences("model", Context.MODE_PRIVATE);
    String encrypted = prefs.getString("key", "");
    JSONObject result = new JSONObject().put("endpoint", prefs.getString("endpoint", "https://api.deepseek.com/v1")).put("model", prefs.getString("model", "deepseek-chat")).put("hasKey", !encrypted.isEmpty());
    if (secret) result.put("apiKey", encrypted.isEmpty() ? "" : decrypt(encrypted));
    return result;
  }
  synchronized void saveConfig(JSONObject data) throws Exception {
    String endpoint = data.getString("endpoint").trim(), model = data.getString("model").trim(); validateURL(endpoint);
    if (model.isEmpty() || model.length() > 200) throw new IOException("模型名称不合法");
    android.content.SharedPreferences.Editor editor = context.getSharedPreferences("model", Context.MODE_PRIVATE).edit().putString("endpoint", endpoint).putString("model", model);
    String key = data.optString("apiKey").trim();
    if (data.optBoolean("clearKey")) editor.remove("key");
    else if (!key.isEmpty()) { if (key.length() > 8192) throw new IOException("API Key 过长"); editor.putString("key", encrypt(key)); }
    if (!editor.commit()) throw new IOException("模型设置保存失败");
  }
  private javax.crypto.SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if (!store.containsAlias("paper-model-key")) {
      KeyGenerator gen = KeyGenerator.getInstance("AES", "AndroidKeyStore");
      gen.init(new KeyGenParameterSpec.Builder("paper-model-key", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); gen.generateKey();
    }
    return (javax.crypto.SecretKey)store.getKey("paper-model-key", null);
  }
  String encrypt(String text) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
    return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
  }
  String decrypt(String text) throws Exception {
    String[] parts = text.split(":"); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
    return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
  }
  private URL validateURL(String endpoint) throws Exception {
    URL url = new URL(endpoint);
    if (!(url.getProtocol().equals("https") || url.getProtocol().equals("http")) || url.getHost().isEmpty() || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null || endpoint.length() > 2000) throw new IOException("API 地址须为 HTTP(S)，不能含账号、查询参数或片段");
    return url;
  }
  JSONObject requestModel(String id, JSONArray messages, JSONObject snapshot) throws Exception {
    JSONObject c = snapshot == null ? config(true) : snapshot; String endpoint = c.getString("endpoint").replaceAll("/+$", "");
    if (!endpoint.endsWith("/chat/completions")) endpoint += "/chat/completions";
    HttpURLConnection conn = (HttpURLConnection)validateURL(endpoint).openConnection();
    connections.put(id, conn);
    try {
      if (cancelled.contains(id)) throw new IOException("已停止");
      conn.setConnectTimeout(30000); conn.setReadTimeout(180000); conn.setInstanceFollowRedirects(false); conn.setRequestMethod("POST"); conn.setDoOutput(true);
      conn.setRequestProperty("Content-Type", "application/json"); String apiKey = c.getString("apiKey"); if (!apiKey.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + apiKey);
      byte[] body = new JSONObject().put("model", c.getString("model")).put("messages", messages).put("stream", false).toString().getBytes(StandardCharsets.UTF_8);
      conn.setFixedLengthStreamingMode(body.length);
      try (OutputStream out = conn.getOutputStream()) { out.write(body); }
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) throw new IOException("模型服务返回 HTTP " + code + (code == 401 ? "：检查 API Key" : code == 429 ? "：额度不足或请求过多" : "：检查服务地址、模型及上下文限制"));
      try (InputStream input = conn.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192]; int n;
        while ((n = input.read(buffer)) != -1) { if (cancelled.contains(id)) throw new IOException("已停止"); out.write(buffer,0,n); if (out.size() > 4_000_000) throw new IOException("模型回答过大，请缩小范围"); }
        return new JSONObject(out.toString("UTF-8"));
      }
    } finally { connections.remove(id); cancelled.remove(id); conn.disconnect(); }
  }
}
