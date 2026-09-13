package android.content;
import java.util.*;
public final class SharedPreferences {
  private final Map<String,String> values = new HashMap<>();
  public String getString(String key,String fallback) { return values.getOrDefault(key,fallback); }
  public Editor edit() { return new Editor(); }
  public final class Editor {
    private final Map<String,String> next = new HashMap<>();
    public Editor putString(String key,String value) { next.put(key,value);return this; }
    public boolean commit() { values.putAll(next);return true; }
  }
}
