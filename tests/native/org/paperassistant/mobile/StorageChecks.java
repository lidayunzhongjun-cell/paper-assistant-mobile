package org.paperassistant.mobile;
import android.content.Context;
import android.net.Uri;
import android.provider.DocumentsContract;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;

public final class StorageChecks {
  private static int count;
  private static void check(boolean value,String name){if(!value)throw new AssertionError(name);count++;System.out.println("PASS "+name);}
  private interface Throwing {void run()throws Exception;}
  private static void fails(Throwing op,String name)throws Exception{try{op.run();throw new AssertionError(name);}catch(IOException expected){check(true,name);}}
  public static void main(String[] args)throws Exception {
    File root=Files.createTempDirectory(Paths.get(args[0]),"native-").toFile();Context context=new Context(new File(root,"private"));Library library=new Library(context);
    File pdf=new File(root,"fixture.pdf");Files.write(pdf.toPath(),"%PDF-1.4\nTest fixture\n".getBytes("UTF-8"));
    String id=library.importPdf(Uri.parse(pdf.getAbsolutePath())).getString("id");JSONObject initial=library.load(id);
    initial.getJSONArray("threads").put(new JSONObject().put("id","t1").put("messages",new JSONArray().put("saved question")));library.save(id,initial);
    JSONObject stale=library.load(id);
    library.commitGraph(id,new JSONObject().put("rawText","complete source").put("graph",new JSONObject().put("value","completed tree")).put("overview","saved narrative"));
    stale.put("readingPage",7);stale.getJSONArray("threads").getJSONObject(0).getJSONArray("messages").put("new question");library.save(id,stale);
    JSONObject current=library.load(id);
    check(current.getJSONObject("graph").getString("value").equals("completed tree")&&current.getLong("graphRevision")==1,"stale reader save preserves completed graph");
    check(current.getInt("readingPage")==7&&current.getJSONArray("threads").getJSONObject(0).getJSONArray("messages").length()==2,"background commit preserves reading and questions");
    GraphTask task=new GraphTask(library,id);JSONObject config=new JSONObject().put("endpoint","https://fixture.invalid/v1").put("model","fixture").put("hasKey",true);
    task.begin(config,false);task.input(new JSONObject().put("rawText","cached source"));
    JSONArray messages=new JSONArray().put(new JSONObject().put("role","user").put("content","test"));String digest=GraphTask.digest(messages);
    task.checkpoint(0,digest,new JSONObject().put("value","first batch"));task.checkpoint(1,"second",new JSONObject().put("value","invalid batch"));task.update("stopped","stopped");
    GraphTask restored=new GraphTask(library,id);restored.begin(config,true);
    check(restored.input().getString("rawText").equals("cached source")&&restored.checkpoints().getJSONObject(0).getString("digest").equals(digest),"checkpoint and extracted text survive runtime recreation");
    restored.discardFrom(1);check(restored.checkpoints().length()==1,"retry discards invalid response and retains earlier batches");
    fails(()->restored.begin(new JSONObject(config.toString()).put("model","different"),true),"changed model cannot reuse previous checkpoints");
    check(!library.readData(id,"graph-task.json").contains("apiKey"),"task files contain no API key");
    restored.update("stopped","stopped");
    File docx=new File(root,"fixture.docx");
    try(java.util.zip.ZipOutputStream zip=new java.util.zip.ZipOutputStream(new FileOutputStream(docx))){zip.putNextEntry(new java.util.zip.ZipEntry("word/document.xml"));zip.write("<document>Word text</document>".getBytes("UTF-8"));zip.closeEntry();}
    String wordId=library.importPdf(Uri.parse(docx.getAbsolutePath())).getString("id");
    check(library.load(wordId).getString("format").equals("docx"),"Word import records format and stays separate from PDF");
    JSONObject wordReading=library.load(wordId);wordReading.put("readingMode","scroll").put("readingZoom",1.75);library.save(wordId,wordReading);
    check(library.load(wordId).getDouble("readingZoom")==1.75,"reading mode and zoom persist for Word");
    try(InputStream in=library.openDocument(wordId,"docx")){check(in.read()=='P',"Word original is served unchanged");}
    fails(()->library.openDocument(wordId,"pdf"),"wrong document format is rejected");
    File selected=new File(root,"chosen");selected.mkdir();String original=library.storageInfo().getString("storage");
    library.changeStorage(Uri.parse(selected.getAbsolutePath()));
    check(library.storageInfo().getBoolean("custom"),"custom document tree becomes active after migration");
    for(String name:new String[]{"document.pdf","paper.json","reading.json","graph-task.json","graph-input.json","graph-checkpoints.json"})
      check(Arrays.equals(Files.readAllBytes(new File(new File(original,id),name).toPath()),Files.readAllBytes(new File(new File(new File(selected,"PaperLibrary"),id),name).toPath())),"migration verifies "+name);
    Library reopened=new Library(context);JSONObject external=reopened.load(id);external.put("readingPage",9);reopened.save(id,external);
    check(reopened.hasData(wordId,"document.docx")&&reopened.load(wordId).getString("readingMode").equals("scroll"),"Word and its reading cache migrate together");
    File wordBackup=new File(root,"word-backup.zip");reopened.export(wordId,Uri.parse(wordBackup.getAbsolutePath()));
    try(java.util.zip.ZipFile zip=new java.util.zip.ZipFile(wordBackup)){check(zip.getEntry("PaperLibrary/"+wordId+"/document.docx")!=null&&zip.getEntry("PaperLibrary/"+wordId+"/reading.json")!=null,"Word backup includes original and cache");}
    reopened.writeData(wordId,"graph-checkpoints.json","[]");reopened.deletePaper(wordId);
    check(!reopened.hasData(wordId,"document.docx")&&!reopened.hasData(wordId,"graph-checkpoints.json")&&reopened.hasData(id,"document.pdf"),"SAF delete removes only selected paper and all cache files");
    fails(()->reopened.save(wordId,wordReading),"queued save cannot resurrect deleted paper");
    fails(()->reopened.deletePaper("../"+id),"delete rejects traversal IDs");
    check(new JSONObject(Library.read(new File(new File(original,id),"reading.json"))).getInt("readingPage")==7&&reopened.load(id).getInt("readingPage")==9,"subsequent writes use selected folder and preserve source copy");
    String before=reopened.readData(id,"reading.json");DocumentsContract.failRenameTarget="reading.json";
    fails(()->reopened.writeData(id,"reading.json","broken replacement"),"provider rename failure is surfaced");DocumentsContract.failRenameTarget=null;
    check(reopened.readData(id,"reading.json").equals(before),"backup recovery preserves original after failed replacement");
    reopened.save(id,reopened.load(id));check(reopened.readData(id,"reading.json").equals(before),"next successful write restores primary filename");
    String activeBeforeFailure=reopened.storageInfo().getString("storage");
    File failed=new File(root,"failed-target");failed.mkdir();context.getContentResolver().failWrites=true;
    fails(()->reopened.changeStorage(Uri.parse(failed.getAbsolutePath())),"migration failure leaves original active");context.getContentResolver().failWrites=false;
    check(reopened.storageInfo().getString("storage").equals(activeBeforeFailure),"failed migration does not change saved location");
    File occupied=new File(root,"occupied");new File(new File(occupied,"PaperLibrary"),id).mkdirs();
    fails(()->reopened.changeStorage(Uri.parse(occupied.getAbsolutePath())),"existing destination library is not overwritten");
    JSONObject clear=reopened.load(id);clear.put("graph",JSONObject.NULL).put("rawText","").put("overview","");reopened.save(id,clear);
    check(reopened.load(id).isNull("graph")&&reopened.load(id).getJSONArray("threads").getJSONObject(0).getJSONArray("messages").length()==2,"current-revision cache clear retains questions");
    reopened.changeStorage(null);check(!reopened.storageInfo().getBoolean("custom")&&reopened.load(id).getInt("readingPage")==9,"migration back to private storage retains latest records");
    reopened.deletePaper(id);check(reopened.list().getJSONArray("papers").length()==0&&!reopened.hasData(id,"reading.json")&&!reopened.hasData(id,"graph-task.json"),"private delete removes paper, history and graph task caches");
    System.out.println("Native storage checks passed: "+count+" (JVM, simulated Android document provider; not a device test).");
  }
}
