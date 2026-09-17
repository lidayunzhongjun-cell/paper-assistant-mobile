package org.paperassistant.mobile;

import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Per-paper durable progress. No API keys are written to these files. */
final class GraphTask {
  private final Library library;
  private final String paperId;
  private JSONObject state;
  GraphTask(Library library, String paperId) throws Exception {
    this.library = library; this.paperId = paperId;
    state = library.hasData(paperId,"graph-task.json") ? new JSONObject(library.readData(paperId,"graph-task.json")) : new JSONObject().put("paperId", paperId).put("status", "none");
  }
  synchronized JSONObject state() throws Exception { return new JSONObject(state.toString()); }
  static JSONObject prepareInput(JSONObject input, JSONObject meta) throws Exception {
    if (input.optString("rawText", "").isEmpty() && !meta.optString("rawText", "").isEmpty()) {
      input.put("rawText", meta.getString("rawText"));
      if (meta.has("pageRanges")) input.put("pageRanges", new JSONArray(meta.getJSONArray("pageRanges").toString()));
    }
    if (!input.has("graphBuildMode")) input.put("graphBuildMode", meta.optString("graphBuildMode", "original"));
    JSONObject saved = meta.optJSONObject("graphSummary"), snapshot = input.optJSONObject("graphSummary");
    if (saved != null && (snapshot == null || snapshot.optString("text").equals(saved.optString("text")))) {
      JSONObject summary = snapshot == null ? new JSONObject() : snapshot;
      for (String key : new String[]{"name", "text", "imported", "headings", "format", "base64"})
        if (saved.has(key)) summary.put(key, saved.get(key));
      input.put("graphSummary", summary);
    }
    return input;
  }
  synchronized void begin(JSONObject config, boolean resume) throws Exception {
    if (resume && !state.optString("status").equals("none")) {
      JSONObject saved = state.getJSONObject("config");
      if (!saved.getString("endpoint").equals(config.getString("endpoint")) || !saved.getString("model").equals(config.getString("model"))) throw new IOException("模型配置已改变，请重新建立图谱");
    } else {
      state.put("runId", java.util.UUID.randomUUID().toString()).put("config", config);
      library.writeData(paperId,"graph-checkpoints.json", "[]");
      library.writeData(paperId,"graph-input.json", "{}");
    }
    update("running", resume ? "正在恢复已完成批次…" : "正在准备后台建图…");
  }
  synchronized void update(String status, String message) throws Exception {
    if (status.equals("running")) state.put("stage", message);
    state.put("status", status).put("message", message).put("updated", System.currentTimeMillis());
    library.writeData(paperId,"graph-task.json", state.toString());
  }
  synchronized JSONObject input() throws Exception {
    return library.hasData(paperId,"graph-input.json") ? new JSONObject(library.readData(paperId,"graph-input.json")) : new JSONObject();
  }
  synchronized void input(JSONObject value) throws Exception { library.writeData(paperId,"graph-input.json", value.toString()); }
  synchronized JSONArray checkpoints() throws Exception {
    return library.hasData(paperId,"graph-checkpoints.json") ? new JSONArray(library.readData(paperId,"graph-checkpoints.json")) : new JSONArray();
  }
  synchronized void checkpoint(int index, String digest, JSONObject response) throws Exception {
    JSONArray records = checkpoints(), next = new JSONArray();
    for (int i = 0; i < index && i < records.length(); i++) next.put(records.get(i));
    if (next.length() != index) throw new IOException("建图断点顺序异常");
    next.put(new JSONObject().put("digest", digest).put("response", response));
    String text = next.toString(); if (text.length() > 25_000_000) throw new IOException("建图断点超过 2500 万字符，请拆分论文");
    library.writeData(paperId,"graph-checkpoints.json", text);
  }
  synchronized void discardFrom(int index) throws Exception {
    JSONArray records = checkpoints(), next = new JSONArray();
    for (int i = 0; i < index && i < records.length(); i++) next.put(records.get(i));
    library.writeData(paperId,"graph-checkpoints.json", next.toString());
  }
  synchronized void releaseCompletedInput() throws Exception {
    library.writeData(paperId,"graph-input.json", "{}");
    library.writeData(paperId,"graph-checkpoints.json", "[]");
  }
  static String digest(JSONArray messages) throws Exception {
    byte[] hash = MessageDigest.getInstance("SHA-256").digest(messages.toString().getBytes(StandardCharsets.UTF_8));
    StringBuilder hex = new StringBuilder(); for (byte b : hash) hex.append(String.format(java.util.Locale.ROOT,"%02x",b & 255)); return hex.toString();
  }
}
