package android.content;
import java.io.*;
import java.util.*;
public final class Context {
  public static final int MODE_PRIVATE = 0;
  private final File root;
  private final Map<String,SharedPreferences> prefs = new HashMap<>();
  private final ContentResolver resolver = new ContentResolver();
  public Context(File root) { this.root=root;root.mkdirs();getCacheDir().mkdirs(); }
  public Context getApplicationContext() { return this; }
  public File getFilesDir() { return root; }
  public File getCacheDir() { return new File(root,"cache"); }
  public ContentResolver getContentResolver() { return resolver; }
  public SharedPreferences getSharedPreferences(String name,int mode) { return prefs.computeIfAbsent(name,k->new SharedPreferences()); }
}
