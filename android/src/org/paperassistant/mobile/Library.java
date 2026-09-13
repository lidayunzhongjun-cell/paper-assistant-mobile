package org.paperassistant.mobile;

import android.content.Context;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.*;

final class Library {
  private static Library instance;
  static synchronized Library get(Context context) throws Exception {
    if (instance == null) instance = new Library(context.getApplicationContext());
    return instance;
  }
  static final String[] GRAPH_FIELDS = {"rawText", "pageRanges", "graph", "overview", "overviewModel", "overviewTime", "graphRevision"};
  private StorageArea area;
  private final Context context;
  private static final String[] DATA_FILES = {"document.pdf", "document.docx", "document.doc", "paper.json", "reading.json", "graph-task.json", "graph-input.json", "graph-checkpoints.json"};
  Library(Context context) throws Exception {
    this.context = context;
    android.content.SharedPreferences prefs = context.getSharedPreferences("storage", Context.MODE_PRIVATE);
    String tree = prefs.getString("tree", ""), name = prefs.getString("local", "PaperLibrary");
    if (!name.matches("PaperLibrary(?:-[0-9]+)?")) throw new IOException("存储设置异常");
    area = tree.isEmpty() ? new StorageArea(context,new File(context.getFilesDir(),name)) : new StorageArea(context,Uri.parse(tree));
  }
  static void validateId(String id) throws IOException {
    if (id == null || !id.matches("[a-f0-9]{64}")) throw new IOException("论文编号不合法");
  }
  synchronized InputStream openPdf(String id) throws Exception { validateId(id); return area.open(id,"document.pdf"); }
  static String format(JSONObject meta) throws IOException {
    String format = meta.optString("format", "pdf");
    if (!format.matches("pdf|docx|doc")) throw new IOException("不支持的论文格式"); return format;
  }
  synchronized InputStream openDocument(String id, String requested) throws Exception {
    validateId(id); String stored = format(new JSONObject(readData(id,"paper.json")));
    if (!stored.equals(requested)) throw new IOException("论文格式不匹配"); return area.open(id,"document." + stored);
  }
  synchronized void deletePaper(String id) throws Exception {
    validateId(id); area.deleteDirectory(id);
  }
  synchronized boolean hasData(String id, String name) throws Exception { validateId(id); return area.exists(id,name); }
  synchronized String readData(String id, String name) throws Exception {
    validateId(id);
    try (InputStream input = area.open(id,name); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[65536]; int n;
      while ((n=input.read(buffer))!=-1) { out.write(buffer,0,n); if (out.size()>90_000_000) throw new IOException("缓存文件过大"); }
      return out.toString("UTF-8");
    }
  }
  synchronized void writeData(String id, String name, String text) throws Exception {
    validateId(id); try (InputStream input = new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8))) { area.write(id,name,input); }
  }
  synchronized JSONObject storageInfo() throws Exception { return new JSONObject().put("storage",area.label()).put("custom",area.tree != null); }
  synchronized JSONObject changeStorage(Uri tree) throws Exception {
    if (tree == null && area.tree == null) return storageInfo();
    if (tree != null && tree.equals(area.tree)) return storageInfo();
    String localName = "PaperLibrary-" + System.currentTimeMillis();
    StorageArea target = tree == null ? new StorageArea(context,new File(context.getFilesDir(),localName)) : new StorageArea(context,tree);
    if (!target.directories().isEmpty()) throw new IOException("目标位置已有论文库，请选择一个空目录；原位置未改变");
    // Copy every managed document and verify content before switching the active root.
    for (String id : area.directories()) {
      if (!id.matches("[a-f0-9]{64}")) continue;
      for (String name : DATA_FILES) if (area.exists(id,name)) {
        byte[] expected;
        try (InputStream source = area.open(id,name)) { expected = digest(source); }
        try (InputStream source = area.open(id,name)) { target.write(id,name,source); }
        try (InputStream copied = target.open(id,name)) { if (!Arrays.equals(expected,digest(copied))) throw new IOException("迁移校验失败，原位置未改变"); }
      }
    }
    android.content.SharedPreferences.Editor editor = context.getSharedPreferences("storage",Context.MODE_PRIVATE).edit();
    editor.putString("tree",tree == null ? "" : tree.toString()).putString("local",localName);
    if (!editor.commit()) throw new IOException("存储位置保存失败，原位置未改变");
    area = target; return storageInfo();
  }
  private static byte[] digest(InputStream input) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[65536]; int n;
    while ((n=input.read(buffer))!=-1) digest.update(buffer,0,n); return digest.digest();
  }
  static String read(File file) throws IOException { return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8); }
  static void atomic(File file, String text) throws IOException {
    File temp = new File(file.getParentFile(), file.getName() + ".tmp");
    try (FileOutputStream out = new FileOutputStream(temp)) { out.write(text.getBytes(StandardCharsets.UTF_8)); out.getFD().sync(); }
    Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
  }
  synchronized JSONObject importPdf(Uri uri) throws Exception {
    String title = "未命名论文.pdf";
    try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) title = cursor.getString(0);
    }
    File temp = File.createTempFile("import-", ".pdf", context.getCacheDir());
    try {
      MessageDigest hash = MessageDigest.getInstance("SHA-256"); long size = 0;
      try (InputStream input = context.getContentResolver().openInputStream(uri); FileOutputStream out = new FileOutputStream(temp)) {
        if (input == null) throw new IOException("无法读取导入文件");
        byte[] buffer = new byte[65536]; int count;
        while ((count = input.read(buffer)) != -1) {
          size += count; if (size > 60L * 1024 * 1024) throw new IOException("单篇论文最大支持 60 MB");
          out.write(buffer, 0, count); hash.update(buffer, 0, count);
        }
        out.getFD().sync();
      }
      String format;
      try (InputStream input = new FileInputStream(temp)) {
        byte[] header = new byte[1024]; int n = input.read(header);
        if (n > 0 && new String(header, 0, n, StandardCharsets.ISO_8859_1).contains("%PDF-")) format = "pdf";
        else if (n >= 4 && header[0] == 'P' && header[1] == 'K') {
          format = "docx"; long expanded = 0; int entries = 0;
          try (ZipFile zip = new ZipFile(temp)) {
            if (zip.getEntry("word/document.xml") == null) throw new IOException("不是有效的 DOCX 文件");
            Enumeration<? extends ZipEntry> list = zip.entries();
            while (list.hasMoreElements()) { ZipEntry entry = list.nextElement(); expanded += entry.getSize();
              if (entry.getSize() < 0 || expanded > 90_000_000 || ++entries > 10000) throw new IOException("Word 文件展开后过大");
            }
          }
        } else if (n >= 8 && Arrays.equals(Arrays.copyOf(header,8), new byte[]{(byte)0xd0,(byte)0xcf,0x11,(byte)0xe0,(byte)0xa1,(byte)0xb1,0x1a,(byte)0xe1}) && title.toLowerCase(Locale.ROOT).endsWith(".doc")) format = "doc";
        else throw new IOException("请选择 PDF、DOCX 或 DOC 论文文件");
      }
      StringBuilder hex = new StringBuilder(); for (byte b : hash.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
      String id = hex.toString();
      if (area.exists(id,"paper.json") && area.exists(id,"document." + format)) return new JSONObject(readData(id,"paper.json")).put("duplicate", true);
      JSONObject meta = new JSONObject().put("id", id).put("format", format).put("title", title.replaceFirst("(?i)\\.(pdf|docx|doc)$", "")).put("size", size).put("imported", System.currentTimeMillis());
      try (InputStream source = new FileInputStream(temp)) { area.write(id,"document." + format,source); }
      writeData(id,"paper.json",meta.toString());
      return meta;
    } finally { if (temp.exists()) temp.delete(); }
  }
  synchronized JSONObject list() throws Exception {
    JSONArray papers = new JSONArray(), errors = new JSONArray();
    for (String id : area.directories()) {
      if (!id.matches("[a-f0-9]{64}")) continue;
      try {
        JSONObject meta = new JSONObject(readData(id,"paper.json"));
        if (!area.exists(id,"document." + format(meta))) throw new IOException();
        if (!id.equals(meta.optString("id")) || !(meta.opt("title") instanceof String)) throw new IOException();
        papers.put(meta);
      }
      catch (Exception e) { errors.put("一篇论文的元数据异常，文件已保留：" + id.substring(0,8)); }
    }
    return new JSONObject().put("papers", papers).put("errors", errors).put("storage", area.label());
  }
  synchronized JSONObject load(String id) throws Exception {
    validateId(id); JSONObject meta = new JSONObject(readData(id,"paper.json"));
    JSONObject paper = area.exists(id,"reading.json") ? new JSONObject(readData(id,"reading.json")) : new JSONObject().put("id", id).put("version", 1).put("threads", new JSONArray()).put("rawText", "").put("overview", "");
    if (!id.equals(paper.optString("id")) || paper.optInt("version") != 1 || !(paper.opt("threads") instanceof JSONArray)) throw new IOException("阅读数据异常，原文件已保留");
    paper.put("title", meta.getString("title")).put("format", format(meta)); return paper;
  }
  synchronized void save(String id, JSONObject paper) throws Exception {
    validateId(id);
    if (!area.exists(id,"paper.json") || !id.equals(paper.optString("id")) || paper.optInt("version") != 1 || !(paper.opt("threads") instanceof JSONArray)) throw new IOException("阅读数据或论文编号不匹配");
    JSONObject current = load(id);
    if (!area.exists(id,"document." + format(current))) throw new IOException("论文文件不存在");
    // A reader save queued before background completion must not erase the new graph.
    if (paper.optLong("graphRevision") != current.optLong("graphRevision")) {
      for (String key : GRAPH_FIELDS) { if (current.has(key)) paper.put(key, current.get(key)); else paper.remove(key); }
    }
    writeReading(id, paper);
  }
  private void writeReading(String id, JSONObject paper) throws Exception {
    String text = paper.toString(); if (text.length() > 20_000_000) throw new IOException("阅读记录超过 2000 万字符，请先导出备份");
    writeData(id,"reading.json",text);
  }
  synchronized long commitGraph(String id, JSONObject result) throws Exception {
    JSONObject paper = load(id);
    for (String key : GRAPH_FIELDS) if (!key.equals("graphRevision") && result.has(key)) paper.put(key, result.get(key));
    long revision = paper.optLong("graphRevision") + 1; paper.put("graphRevision", revision);
    writeReading(id, paper); return revision;
  }
  synchronized void export(String id, Uri destination) throws Exception {
    validateId(id);
    try (OutputStream stream = context.getContentResolver().openOutputStream(destination, "wt")) {
      if (stream == null) throw new IOException("无法写入备份文件");
      try (ZipOutputStream zip = new ZipOutputStream(stream)) {
        for (String name : DATA_FILES) {
          if (!area.exists(id,name)) continue;
          zip.putNextEntry(new ZipEntry("PaperLibrary/" + id + "/" + name));
          try (InputStream input = area.open(id,name)) { StorageArea.copy(input,zip); } zip.closeEntry();
        }
      }
    }
  }
}
