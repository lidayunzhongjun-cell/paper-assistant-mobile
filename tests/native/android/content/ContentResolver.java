package android.content;
import android.net.Uri;
import android.database.Cursor;
import android.provider.DocumentsContract;
import java.io.*;
import java.util.*;
public final class ContentResolver {
  public boolean failWrites;
  public InputStream openInputStream(Uri uri) throws IOException { return new FileInputStream(uri.toString()); }
  public OutputStream openOutputStream(Uri uri,String mode) throws IOException {
    if(failWrites)throw new IOException("模拟写入失败");return new FileOutputStream(uri.toString());
  }
  public Cursor query(Uri uri,String[] columns,String where,String[] args,String order) {
    boolean children = uri.toString().startsWith("children:");
    File target = new File(children ? uri.toString().substring(9) : uri.toString());
    File[] records = children ? target.listFiles() : new File[]{target};
    if(records==null)return null;
    return new Cursor() {
      int index=-1;
      public boolean moveToFirst(){index=0;return records.length>0;}
      public boolean moveToNext(){return ++index<records.length;}
      public String getString(int col){File f=records[index];switch(columns[col]){case "id":return f.getAbsolutePath();case "name":return f.getName();case "mime":return f.isDirectory()?DocumentsContract.Document.MIME_TYPE_DIR:"application/octet-stream";default:return "";}}
      public int getInt(int col){return DocumentsContract.Document.FLAG_SUPPORTS_RENAME;}
      public void close(){}
    };
  }
}
