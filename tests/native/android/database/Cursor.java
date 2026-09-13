package android.database;
public interface Cursor extends AutoCloseable {
  boolean moveToFirst(); boolean moveToNext(); String getString(int column); int getInt(int column); void close();
}
