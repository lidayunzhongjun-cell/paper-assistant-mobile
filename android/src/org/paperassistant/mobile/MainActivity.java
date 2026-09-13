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

public final class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private WebView web;
  private Library library;
  private final ExecutorService storage = Executors.newSingleThreadExecutor();
  private final ExecutorService network = Executors.newFixedThreadPool(2);
  private ModelClient model;
  private TranslationClient translator;
  private String pickerRequest, exportPaper;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    try { library = Library.get(this); model = new ModelClient(this); translator = new TranslationClient(this,model); }
    catch (Exception e) {
      new AlertDialog.Builder(this).setMessage("存储目录暂时无法访问。可重新选择原来的文件夹恢复权限，或打开默认论文库；原目录数据保留。")
        .setPositiveButton("重新选择目录", (d,w) -> startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE),104))
        .setNegativeButton("默认目录", (d,w) -> { getSharedPreferences("storage",MODE_PRIVATE).edit().putString("tree","").putString("local","PaperLibrary").commit(); recreate(); }).show(); return;
    }
    getWindow().setStatusBarColor(Color.rgb(247,245,239));
    getWindow().setNavigationBarColor(Color.rgb(247,245,239));
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
    android.widget.FrameLayout root = new android.widget.FrameLayout(this);
    root.setBackgroundColor(Color.rgb(247,245,239));
    web = new ReadingWebView(this); web.setBackgroundColor(Color.rgb(247,245,239));
    root.addView(web, new android.widget.FrameLayout.LayoutParams(-1, -1)); setContentView(root);
    // Resize the WebView viewport itself: padding WebView does not reliably inset HTML.
    root.setOnApplyWindowInsetsListener((v, insets) -> {
      if (Build.VERSION.SDK_INT >= 30) {
        android.graphics.Insets pad = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
        v.setPadding(pad.left, pad.top, pad.right, pad.bottom);
        return WindowInsets.CONSUMED;
      }
      // Before API 30 the decor already fits system windows.
      return insets;
    });
    root.requestApplyInsets();
    AppWeb.configure(web, this, library);
    web.addJavascriptInterface(new Bridge(), "PaperNative");
    web.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
        new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("确认", (d,w) -> result.confirm()).setNegativeButton("取消", (d,w) -> result.cancel()).setOnCancelListener(d -> result.cancel()).show(); return true;
      }
      @Override public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
        new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("知道了", (d,w) -> result.confirm()).setOnCancelListener(d -> result.confirm()).show(); return true;
      }
    });
    web.loadUrl("https://" + HOST + "/assets/index.html");
  }
  private void respond(String id, Object value, String error) {
    if (isFinishing() || isDestroyed()) return;
    runOnUiThread(() -> {
      try {
        JSONObject message = new JSONObject().put("id", id).put("value", value == null ? JSONObject.NULL : value).put("error", error == null ? JSONObject.NULL : error);
        web.evaluateJavascript("window.nativeReply && window.nativeReply(" + message + ")", null);
      } catch (Exception ignored) { }
    });
  }
  private final class Bridge {
    @JavascriptInterface public void post(String request) {
      if (request == null || request.length() > 21_000_000) return;
      try {
        JSONObject data = new JSONObject(request); String id = data.getString("requestId"), op = data.getString("op");
        if (!id.matches("r[0-9]+")) return;
        if (op.equals("cancel")) {
          String target = data.getString("target"); new Thread(() -> { model.cancel(target); translator.cancel(target); }, "cancel-request").start();
          respond(id, true, null); return;
        }
        if (op.equals("import") || op.equals("importSummary") || op.equals("export") || op.equals("storageChoose")) { runOnUiThread(() -> pick(id, op, data.optString("paperId"))); return; }
        ((op.equals("model") || op.equals("translate")) ? network : storage).execute(() -> {
          try {
            Object result;
            switch (op) {
              case "list": result = library.list(); break;
              case "delete": GraphService.deletePaper(MainActivity.this, data.getString("paperId")); result = true; break;
              case "storageInfo": result = library.storageInfo(); break;
              case "storageDefault":
                if (GraphService.anyRunning()) throw new IOException("请先停止后台建图，再迁移存储位置");
                result = library.changeStorage(null); break;
              case "load": result = library.load(data.getString("paperId")); break;
              case "save": library.save(data.getString("paperId"), data.getJSONObject("paper")); result = true; break;
              case "translationConfig": result = translator.config(false); break;
              case "saveTranslationConfig": translator.save(data.getJSONObject("config")); result = translator.config(false); break;
              case "translate": result = translator.translate(id,data); break;
              case "getConfig": result = model.config(false); break;
              case "saveConfig": model.saveConfig(data.getJSONObject("config")); result = model.config(false); break;
              case "model": result = model.requestModel(id, data.getJSONArray("messages"), null); break;
              case "graphStart":
                result = GraphService.launch(MainActivity.this, data.getString("paperId"), data.optBoolean("resume"));
                runOnUiThread(() -> {
                  if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 201);
                });
                break;
              case "graphStatus": result = GraphService.status(MainActivity.this, data.getString("paperId")); break;
              case "graphStop": GraphService.cancel(data.getString("paperId")); result = true; break;
              case "graphData":
                JSONObject saved = library.load(data.getString("paperId")); JSONObject fields = new JSONObject();
                for (String key : Library.GRAPH_FIELDS) if (saved.has(key)) fields.put(key, saved.get(key));
                result = fields; break;
              case "graphForget":
                String paperId = data.getString("paperId");
                if (GraphService.running(paperId)) throw new IOException("请先停止建图再清除全文缓存");
                GraphTask old = new GraphTask(library, paperId); old.releaseCompletedInput(); old.update("none", ""); result = true; break;
              default: throw new IOException("未知操作");
            }
            respond(id, result, null);
          } catch (Exception e) { respond(id, null, op.equals("translate") ? ModelClient.safeMessage(e).replace("模型", "翻译") : ModelClient.safeMessage(e)); }
        });
      } catch (Exception ignored) { }
    }
  }
  private void pick(String requestId, String op, String id) {
    if (pickerRequest != null) { respond(requestId, null, "请先完成当前文件选择"); return; }
    try {
      Intent intent;
      if (op.equals("importSummary")) {
        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}).addCategory(Intent.CATEGORY_OPENABLE);
      } else if (op.equals("import")) {
        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}).addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      } else if (op.equals("storageChoose")) {
        if (GraphService.anyRunning()) throw new IOException("请先停止后台建图，再迁移存储位置");
        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
      } else {
        library.load(id); exportPaper = id;
        intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/zip").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, "Paper-" + id.substring(0,8) + ".zip");
      }
      pickerRequest = requestId; startActivityForResult(intent, op.equals("importSummary") ? 105 : op.equals("import") ? 101 : op.equals("export") ? 102 : 103);
    } catch (Exception e) { pickerRequest = null; respond(requestId, null, ModelClient.safeMessage(e)); }
  }
  @Override protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == 104) {
      if (result == RESULT_OK && data != null && data.getData() != null) {
        try { getContentResolver().takePersistableUriPermission(data.getData(),data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
          getSharedPreferences("storage",MODE_PRIVATE).edit().putString("tree",data.getData().toString()).commit(); recreate();
        } catch (Exception e) { new AlertDialog.Builder(this).setMessage("无法取得目录权限，请重新打开 App 后选择").setPositiveButton("关闭",(d,w)->finish()).show(); }
      } return;
    }
    if (request != 101 && request != 102 && request != 103 && request != 105) return;
    String id = pickerRequest, paperId = exportPaper; pickerRequest = null;
    if (id == null) return;
    if (result != RESULT_OK || data == null) { respond(id, JSONObject.NULL, null); return; }
    storage.execute(() -> {
      try {
        if (request == 105) {
          Uri uri = data.getData(); String name = "";
          try (android.database.Cursor cursor = getContentResolver().query(uri, new String[]{android.provider.OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0); }
          if (name == null || !name.toLowerCase(Locale.ROOT).matches(".*\\.(txt|docx|doc)$")) throw new IOException("请选择 TXT、DOCX 或 DOC 总结文件");
          try (InputStream input = getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int n; while ((n = input.read(buffer)) != -1) { out.write(buffer,0,n); if (out.size() > 2_000_000) throw new IOException("总结文件请控制在 2 MB 内"); }
            respond(id, new JSONObject().put("name",name).put("base64",Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP)), null);
          }
        } else if (request == 103) {
          if (GraphService.anyRunning()) throw new IOException("请先停止后台建图，再迁移存储位置");
          getContentResolver().takePersistableUriPermission(data.getData(),data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION));
          respond(id, library.changeStorage(data.getData()), null);
        }
        else if (request == 102) { library.export(paperId, data.getData()); respond(id, true, null); }
        else {
          JSONArray imported = new JSONArray(), errors = new JSONArray(); ArrayList<Uri> uris = new ArrayList<>();
          if (data.getClipData() != null) for (int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
          else if (data.getData() != null) uris.add(data.getData());
          for (Uri uri : uris) { try { imported.put(library.importPdf(uri)); } catch (Exception e) { errors.put(ModelClient.safeMessage(e)); } }
          respond(id, new JSONObject().put("papers", imported).put("errors", errors), null);
        }
      } catch (Exception e) { respond(id, null, ModelClient.safeMessage(e)); }
    });
  }
  @Override public void onBackPressed() { if (web != null) web.evaluateJavascript("window.mobileBack && window.mobileBack()", null); else super.onBackPressed(); }
  @Override protected void onPause() { super.onPause(); if (web != null) web.evaluateJavascript("window.mobilePause && window.mobilePause()", null); }
  @Override protected void onResume() { super.onResume(); if (web != null) web.evaluateJavascript("window.mobileResume && window.mobileResume()", null); }
  @Override protected void onDestroy() {
    if (model != null) model.close(); if (translator != null) translator.close(); network.shutdownNow(); storage.shutdown();
    if (web != null) { web.removeJavascriptInterface("PaperNative"); web.destroy(); } super.onDestroy();
  }
}
