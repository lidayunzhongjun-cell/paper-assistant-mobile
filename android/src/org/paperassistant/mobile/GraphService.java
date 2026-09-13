package org.paperassistant.mobile;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.webkit.*;
import org.json.*;
import java.io.IOException;
import java.util.concurrent.*;

/** Owns the graph runtime independently of any reader Activity. */
public final class GraphService extends Service {
  private static final String CHANNEL = "paper-graph";
  private static final int NOTIFICATION = 41;
  private static volatile String activePaper;
  private static volatile GraphService live;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());
  private volatile boolean stopping, terminal;
  private volatile long lastActivity = SystemClock.elapsedRealtime();
  private Library library;
  private GraphTask task;
  private ModelClient model;
  private JSONObject config;
  private String paperId;
  private WebView runtime;
  private PowerManager.WakeLock wakeLock;

  static synchronized JSONObject launch(Context context, String id, boolean resume) throws Exception {
    if (activePaper != null) throw new IOException("已有一篇论文正在后台建图，请完成或停止后再开始");
    Library library = Library.get(context); library.load(id);
    GraphTask task = new GraphTask(library, id);
    task.begin(new ModelClient(context).config(false), resume);
    activePaper = id;
    try {
      context.startForegroundService(new Intent(context, GraphService.class).putExtra("paperId", id));
      return task.state();
    } catch (Exception e) { activePaper = null; task.update("error", "无法启动后台建图服务，请回到 App 后重试"); throw e; }
  }
  static boolean running(String id) { return id != null && id.equals(activePaper); }
  static synchronized void deletePaper(Context context, String id) throws Exception {
    if (running(id)) throw new IOException("建图任务正在停止，请稍后重试删除");
    Library.get(context).deletePaper(id);
  }
  static boolean anyRunning() { return activePaper != null; }
  static JSONObject status(Context context, String id) throws Exception {
    GraphTask task = new GraphTask(Library.get(context), id); JSONObject state = task.state();
    if ("running".equals(state.optString("status")) && !running(id)) {
      task.update("interrupted", "后台任务已中断，可从已保存批次继续"); state = task.state();
    }
    return state.put("active",running(id));
  }
  static void cancel(String id) throws Exception {
    GraphService service = live;
    if (service == null || !running(id)) throw new IOException("后台服务尚未就绪，请稍后重试");
    service.stopTask("stopped", "建图已停止，可从已完成批次继续");
  }
  @Override public void onCreate() {
    super.onCreate(); live = this;
    NotificationManager manager = getSystemService(NotificationManager.class);
    manager.createNotificationChannel(new NotificationChannel(CHANNEL, "全文知识图谱", NotificationManager.IMPORTANCE_LOW));
    try {
      if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification("正在准备后台建图…", true), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
      else startForeground(NOTIFICATION, notification("正在准备后台建图…", true));
    } catch (RuntimeException e) {
      stopping = true; terminal = true;
      try { if (activePaper != null) new GraphTask(Library.get(this), activePaper).update("interrupted", "系统暂不允许后台建图，请回到 App 后重试"); } catch (Exception ignored) { }
      stopSelf();
    }
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    if (stopping) return START_NOT_STICKY;
    if (intent == null) { stopSelf(); return START_NOT_STICKY; }
    if ("stop".equals(intent.getAction())) { stopTask("stopped", "建图已停止，可从已完成批次继续"); return START_NOT_STICKY; }
    if (paperId != null) return START_NOT_STICKY;
    paperId = intent.getStringExtra("paperId");
    try {
      library = Library.get(this); task = new GraphTask(library, paperId); model = new ModelClient(this); config = model.config(true);
      JSONObject planned = task.state().getJSONObject("config");
      if (!planned.getString("endpoint").equals(config.getString("endpoint")) || !planned.getString("model").equals(config.getString("model"))) throw new IOException("模型配置已改变，请重新建立图谱");
      wakeLock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PaperAssistant:Graph");
      wakeLock.acquire(6 * 60 * 60 * 1000L);
      // Android 15 dataSync has a system time budget; stop cleanly before a single six-hour run.
      main.postDelayed(() -> stopTask("interrupted", "本次后台运行已达时限，可回到 App 继续"), 345 * 60 * 1000L);
      runtime = new WebView(getApplicationContext()); AppWeb.configure(runtime, this, library, () -> stopTask("error", "后台运行环境已中断，可从已完成批次继续"));
      runtime.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
      runtime.setWebChromeClient(new WebChromeClient() {
        @Override public boolean onConsoleMessage(ConsoleMessage message) {
          if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR && message.message().matches(".*(Uncaught|SyntaxError|ReferenceError|TypeError).*")) stopTask("error", "后台脚本运行异常，请重试或更新 Android System WebView");
          return true;
        }
      });
      runtime.addJavascriptInterface(new Bridge(), "PaperNative");
      runtime.loadUrl("https://" + AppWeb.HOST + "/assets/graph-worker.html");
      main.postDelayed(new Runnable() { public void run() {
        if (stopping || terminal) return;
        if (SystemClock.elapsedRealtime() - lastActivity > 10 * 60 * 1000L) stopTask("error", "后台运行环境长时间无响应，可从已完成批次继续");
        else main.postDelayed(this,60000);
      } },60000);
    } catch (Exception e) { stopTask("error", ModelClient.safeMessage(e)); }
    return START_NOT_STICKY;
  }
  private Notification notification(String message, boolean ongoing) {
    PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder = new Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(ongoing ? "正在建立全文知识图谱" : "全文知识图谱")
      .setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(open)
      .setOngoing(ongoing).setOnlyAlertOnce(true).setShowWhen(false);
    if (ongoing) {
      PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, GraphService.class).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      builder.addAction(new Notification.Action.Builder(null, "停止", stop).build()).setProgress(0, 0, true);
    }
    return builder.build();
  }
  private void notifyProgress(String message, boolean ongoing) {
    getSystemService(NotificationManager.class).notify(NOTIFICATION, notification(message, ongoing));
  }
  private void reply(String id, Object value, String error) {
    main.post(() -> {
      if (runtime == null || terminal) return;
      try { JSONObject result = new JSONObject().put("id", id).put("value", value == null ? JSONObject.NULL : value).put("error", error == null ? JSONObject.NULL : error);
        runtime.evaluateJavascript("window.nativeReply && window.nativeReply(" + result + ")", null);
      } catch (Exception ignored) { }
    });
  }
  private void checkRunning() throws IOException { if (stopping || terminal) throw new IOException("已停止"); }
  private final class Bridge {
    @JavascriptInterface public void post(String raw) {
      if (raw == null || raw.length() > 21_000_000 || stopping) return;
      lastActivity = SystemClock.elapsedRealtime();
      try {
        JSONObject req = new JSONObject(raw); String id = req.getString("requestId"), op = req.getString("op");
        if (!id.matches("r[0-9]+")) return;
        if ("cancel".equals(op)) { new Thread(() -> model.cancel(req.optString("target")), "graph-cancel").start(); return; }
        executor.execute(() -> {
          try {
            checkRunning(); Object result = true;
            switch (op) {
              case "jobInput":
                JSONObject input = task.input(); JSONObject meta = library.load(paperId);
                input.put("id", paperId).put("title", meta.getString("title")).put("format", Library.format(meta));
                if (!input.has("graphBuildMode")) {
                  input.put("graphBuildMode", meta.optString("graphBuildMode", "original"));
                  if (meta.has("graphSummary")) { JSONObject summary = meta.getJSONObject("graphSummary"); input.put("graphSummary", new JSONObject().put("name", summary.getString("name")).put("text", summary.getString("text")).put("imported", summary.optLong("imported"))); }
                  task.input(input);
                }
                result = new JSONObject().put("paper", input).put("config", task.state().getJSONObject("config")); break;
              case "jobExtracted": task.input(req.getJSONObject("paper")); break;
              case "jobProgress":
                String message = req.getString("message"); task.update("running", message); notifyProgress(message, true); break;
              case "model":
                JSONArray messages = req.getJSONArray("messages"); int index = req.getInt("index");
                if (index < 0 || index > 10000) throw new IOException("建图请求序号异常");
                String digest = GraphTask.digest(messages); JSONArray records = task.checkpoints();
                JSONObject cached = records.optJSONObject(index);
                if (cached != null && digest.equals(cached.optString("digest"))) result = cached.getJSONObject("response");
                else {
                  result = model.requestModel(id, messages, config); checkRunning();
                  // Save the successful response before allowing the next stage to run.
                  task.checkpoint(index, digest, (JSONObject)result);
                }
                break;
              case "jobComplete":
                synchronized (GraphService.this) {
                  checkRunning(); library.commitGraph(paperId, req.getJSONObject("result"));
                  task.update("done", "全文知识图谱已保存"); terminal = true;
                }
                try { task.releaseCompletedInput(); } catch (Exception ignored) { }
                main.post(() -> { notifyProgress("全文知识图谱已保存，点击返回阅读", false); stopForeground(STOP_FOREGROUND_DETACH); stopSelf(); }); return;
              case "jobError":
                // Do not replay a model response that failed graph validation forever.
                task.discardFrom(Math.max(0, req.optInt("retryIndex", 0)));
                stopTask("error", req.optString("message", "建图失败，可重试")); return;
              default: throw new IOException("后台操作不支持");
            }
            checkRunning(); reply(id, result, null);
          } catch (Exception e) { if (!stopping) reply(id, null, ModelClient.safeMessage(e)); }
        });
      } catch (Exception ignored) { }
    }
  }
  private synchronized void stopTask(String status, String message) {
    if (terminal || stopping) return; stopping = true;
    if (model != null) new Thread(model::close, "graph-stop").start();
    executor.execute(() -> {
      try { if (task != null) task.update(status, message); } catch (Exception ignored) { }
      terminal = true;
      main.post(() -> { notifyProgress(message, false); stopForeground(STOP_FOREGROUND_DETACH); stopSelf(); });
    });
  }
  @Override public void onTimeout(int startId, int type) {
    stopping = true;
    try { if (task != null) task.update("interrupted", "系统后台运行额度已用完，请返回 App 后继续"); } catch (Exception ignored) { }
    terminal = true; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
  }
  @Override public void onDestroy() {
    stopping = true;
    if (!terminal && task != null) try { task.update("interrupted", "后台任务已中断，可从已保存批次继续"); } catch (Exception ignored) { }
    if (model != null) new Thread(model::close, "graph-close").start();
    main.removeCallbacksAndMessages(null);
    if (runtime != null) { runtime.removeJavascriptInterface("PaperNative"); runtime.destroy(); runtime = null; }
    if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    executor.shutdownNow(); live = null; activePaper = null; super.onDestroy();
  }
  @Override public IBinder onBind(Intent intent) { return null; }
}
