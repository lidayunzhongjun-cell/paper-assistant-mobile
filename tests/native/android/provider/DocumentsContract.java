package android.provider;
import android.content.ContentResolver;
import android.net.Uri;
import java.io.*;
import java.nio.file.*;
public final class DocumentsContract {
  public static String failRenameTarget;
  public static final class Document {
    public static final String MIME_TYPE_DIR="directory", COLUMN_DOCUMENT_ID="id", COLUMN_DISPLAY_NAME="name", COLUMN_MIME_TYPE="mime", COLUMN_FLAGS="flags";
    public static final int FLAG_SUPPORTS_RENAME=64;
  }
  public static String getTreeDocumentId(Uri uri){return uri.toString();}
  public static String getDocumentId(Uri uri){return uri.toString();}
  public static Uri buildDocumentUriUsingTree(Uri tree,String id){return Uri.parse(id);}
  public static Uri buildChildDocumentsUriUsingTree(Uri tree,String id){return Uri.parse("children:"+id);}
  public static Uri createDocument(ContentResolver resolver,Uri parent,String mime,String name)throws IOException {
    File file=new File(parent.toString(),name);boolean ok=Document.MIME_TYPE_DIR.equals(mime)?file.mkdir():file.createNewFile();
    return ok?Uri.parse(file.getAbsolutePath()):null;
  }
  public static Uri renameDocument(ContentResolver resolver,Uri uri,String name)throws IOException {
    if(name.equals(failRenameTarget))throw new IOException("模拟重命名失败");
    File file=new File(uri.toString()),target=new File(file.getParentFile(),name);Files.move(file.toPath(),target.toPath());return Uri.parse(target.getAbsolutePath());
  }
  public static boolean deleteDocument(ContentResolver resolver,Uri uri)throws IOException {
    Path target=new File(uri.toString()).toPath();if(!Files.exists(target))return false;
    Files.walkFileTree(target,new SimpleFileVisitor<Path>(){
      @Override public FileVisitResult visitFile(Path p,java.nio.file.attribute.BasicFileAttributes a)throws IOException{Files.delete(p);return FileVisitResult.CONTINUE;}
      @Override public FileVisitResult postVisitDirectory(Path p,IOException e)throws IOException{if(e!=null)throw e;Files.delete(p);return FileVisitResult.CONTINUE;}
    });return true;
  }
}
