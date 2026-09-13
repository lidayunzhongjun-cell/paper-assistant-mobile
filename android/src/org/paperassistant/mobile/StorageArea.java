package org.paperassistant.mobile;

import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** The active library can be private files or a user-granted Android document tree. */
final class StorageArea {
  private final Context context;
  final File local;
  final Uri tree, root;
  StorageArea(Context context, File directory) throws IOException {
    this.context = context; local = directory; tree = null; root = null;
    if (!local.exists() && !local.mkdirs()) throw new IOException("无法建立论文目录");
  }
  StorageArea(Context context, Uri tree) throws Exception {
    this.context = context; this.tree = tree; local = null;
    Uri selected = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    Uri found = child(selected, "PaperLibrary");
    root = found != null ? found : DocumentsContract.createDocument(context.getContentResolver(), selected, DocumentsContract.Document.MIME_TYPE_DIR, "PaperLibrary");
    if (root == null) throw new IOException("无法在所选位置建立论文库");
  }
  String label() { return local != null ? local.getAbsolutePath() : DocumentsContract.getTreeDocumentId(tree) + "/PaperLibrary"; }
  static String mime(String name) {
    return name.endsWith(".pdf") ? "application/pdf" : name.endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : name.endsWith(".doc") ? "application/msword" : "application/json";
  }
  void deleteDirectory(String id) throws Exception {
    Library.validateId(id);
    if (local != null) {
      File target = new File(local,id);
      if (!target.getCanonicalFile().getParentFile().equals(local.getCanonicalFile()) || Files.isSymbolicLink(target.toPath())) throw new IOException("论文删除路径异常");
      if (!target.exists()) return;
      // Walk without FOLLOW_LINKS: a link inside this folder is unlinked, never traversed.
      Files.walkFileTree(target.toPath(), new SimpleFileVisitor<Path>() {
        @Override public FileVisitResult visitFile(Path path, java.nio.file.attribute.BasicFileAttributes attrs) throws IOException { Files.delete(path); return FileVisitResult.CONTINUE; }
        @Override public FileVisitResult postVisitDirectory(Path path, IOException error) throws IOException { if (error != null) throw error; Files.delete(path); return FileVisitResult.CONTINUE; }
      });
    } else {
      Uri dir = child(root,id); if (dir == null) return;
      if (!DocumentsContract.deleteDocument(context.getContentResolver(),dir) || child(root,id) != null) throw new IOException("无法完整删除论文，请检查目录权限后重试");
    }
  }
  private Uri child(Uri parent, String name) throws Exception {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(parent));
    try (Cursor c = context.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
      if (c == null) throw new IOException("无法读取存储目录，请重新选择位置");
      while (c.moveToNext()) if (name.equals(c.getString(1))) return DocumentsContract.buildDocumentUriUsingTree(tree, c.getString(0));
    }
    return null;
  }
  private Uri directory(String id, boolean create) throws Exception {
    Uri dir = child(root, id);
    if (dir == null && create) dir = DocumentsContract.createDocument(context.getContentResolver(), root, DocumentsContract.Document.MIME_TYPE_DIR, id);
    if (dir == null) throw new IOException("论文目录不存在"); return dir;
  }
  List<String> directories() throws Exception {
    if (local != null) {
      File[] dirs = local.listFiles(); if (dirs == null) throw new IOException("无法读取论文库");
      ArrayList<String> result = new ArrayList<>(); for (File dir : dirs) if (dir.isDirectory()) result.add(dir.getName()); return result;
    }
    ArrayList<String> result = new ArrayList<>();
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getDocumentId(root));
    try (Cursor c = context.getContentResolver().query(children, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE}, null, null, null)) {
      if (c == null) throw new IOException("无法读取所选论文库");
      while (c.moveToNext()) if (DocumentsContract.Document.MIME_TYPE_DIR.equals(c.getString(1))) result.add(c.getString(0));
    }
    return result;
  }
  boolean exists(String id, String name) throws Exception {
    if (local != null) return new File(new File(local,id),name).isFile();
    Uri dir = child(root,id); return dir != null && (child(dir,name) != null || child(dir,name + ".bak") != null);
  }
  InputStream open(String id, String name) throws Exception {
    if (local != null) return new FileInputStream(new File(new File(local,id),name));
    Uri dir = directory(id,false), file = child(dir,name);
    if (file == null) file = child(dir,name + ".bak");
    if (file == null) throw new IOException("论文文件不存在：" + name);
    InputStream input = context.getContentResolver().openInputStream(file);
    if (input == null) throw new IOException("无法读取论文文件"); return input;
  }
  void write(String id, String name, InputStream input) throws Exception {
    if (local != null) {
      File dir = new File(local,id); if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法建立论文目录");
      File file = new File(dir,name), temp = new File(dir,name + ".tmp");
      try (FileOutputStream out = new FileOutputStream(temp)) { copy(input,out); out.getFD().sync(); }
      Files.move(temp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE); return;
    }
    Uri dir = directory(id,true);
    Uri temp = DocumentsContract.createDocument(context.getContentResolver(), dir, mime(name), ".pending-" + name + "-" + UUID.randomUUID());
    if (temp == null) throw new IOException("所选目录无法写入");
    try {
      try (Cursor c = context.getContentResolver().query(temp, new String[]{DocumentsContract.Document.COLUMN_FLAGS}, null,null,null)) {
        if (c == null || !c.moveToFirst() || (c.getInt(0) & DocumentsContract.Document.FLAG_SUPPORTS_RENAME) == 0) throw new IOException("该目录不支持安全替换文件，请选择手机内部存储中的普通文件夹");
      }
      try (OutputStream out = context.getContentResolver().openOutputStream(temp,"wt")) {
        if (out == null) throw new IOException("所选目录无法写入"); copy(input,out);
      }
      Uri current = child(dir,name), backup = child(dir,name + ".bak");
      if (current == null && backup != null) { current = rename(backup,name); backup = null; }
      if (current != null) {
        if (backup != null && !DocumentsContract.deleteDocument(context.getContentResolver(),backup)) throw new IOException("无法更新存储备份");
        backup = rename(current,name + ".bak");
      }
      try { rename(temp,name); temp = null; }
      catch (Exception e) { if (backup != null) try { rename(backup,name); } catch (Exception ignored) { } throw e; }
      if (backup != null) try { DocumentsContract.deleteDocument(context.getContentResolver(),backup); } catch (Exception ignored) { }
    } finally { if (temp != null) try { DocumentsContract.deleteDocument(context.getContentResolver(),temp); } catch (Exception ignored) { } }
  }
  private Uri rename(Uri file, String name) throws Exception {
    Uri renamed = DocumentsContract.renameDocument(context.getContentResolver(),file,name);
    if (renamed == null) throw new IOException("所选目录无法安全替换文件，原文件已保留"); return renamed;
  }
  static void copy(InputStream input, OutputStream output) throws IOException {
    byte[] buffer = new byte[65536]; int n; while ((n=input.read(buffer))!=-1) output.write(buffer,0,n);
  }
}
