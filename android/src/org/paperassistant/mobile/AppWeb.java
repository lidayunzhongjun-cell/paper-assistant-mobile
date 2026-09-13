package org.paperassistant.mobile;

import android.content.Context;
import android.net.Uri;
import android.webkit.*;
import java.io.*;
import java.util.*;

final class AppWeb {
  static final String HOST = "appassets.androidplatform.net";
  static void configure(WebView web, Context context, Library library) {
    configure(web, context, library, null);
  }
  static void configure(WebView web, Context context, Library library, Runnable fatal) {
    WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(false);
    s.setAllowFileAccess(false); s.setAllowContentAccess(false); s.setSupportMultipleWindows(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setMediaPlaybackRequiresUserGesture(true);
    s.setTextZoom(100); s.setSupportZoom(false); CookieManager.getInstance().setAcceptCookie(false);
    web.setWebViewClient(new WebViewClient() {
      @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (fatal != null && request.isForMainFrame()) fatal.run();
      }
      @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (fatal != null) { fatal.run(); return true; } return false;
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
          Uri uri = request.getUrl(); String path = uri.getPath();
          if (!"https".equals(uri.getScheme()) || !HOST.equals(uri.getHost()) || path == null || path.contains("..")) return blocked();
          InputStream data; String mime;
          if (path.matches("/papers/[a-f0-9]{64}/document\\.(pdf|docx|doc)")) {
            String format = path.substring(path.lastIndexOf('.')+1);
            data = library.openDocument(path.split("/")[2],format); mime = StorageArea.mime(path);
          } else if (path.startsWith("/assets/")) {
            data = context.getAssets().open(path.substring(8));
            mime = path.endsWith(".html") ? "text/html" : path.endsWith(".js") || path.endsWith(".mjs") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
          } else return blocked();
          Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
          headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
          return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, data);
        } catch (Exception e) { return blocked(); }
      }
    });
  }
  private static WebResourceResponse blocked() { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0])); }
}
