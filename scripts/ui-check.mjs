import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { docFixture, docxFixture } from '../tests/word-fixture.mjs';
const root = path.resolve(import.meta.dirname,'..'); const out = path.join(root,'test-results'); await mkdir(out,{recursive:true});
const id = 'a'.repeat(64), files = new Map(); let imported = false, modelCalls = 0;
let job = { status: 'none' }, worker, graphInput = {}, checkpoints = [], holdGraph = false, releaseGraph, replayed = 0;
let failGraphAt = null, customStorage = false, graphSourceOverride = '', nextImport = 'pdf', activeId = id;
const library = new Map(), wordId = 'b'.repeat(64), docId = 'c'.repeat(64);
let acceptDialog = true, translationCalls=0, failTranslation=false;
let translationConfig={libreEndpoint:'https://libretranslate.com',libreHasKey:false,deeplHasKey:false,laraHasKey:false,laraIdHasKey:false};
const graphFields = ['rawText','pageRanges','graph','overview','overviewModel','overviewTime','graphRevision'];
const fixtureConfig = { endpoint:'https://fixture.invalid/v1',model:'fixture',hasKey:true };
const errors = [];
const copy = value => JSON.parse(JSON.stringify(value));
async function until(fn) { const deadline = Date.now() + 20000; while (!fn()) { if (Date.now() > deadline) throw new Error('Background task timeout: ' + JSON.stringify(job)); await new Promise(r => setTimeout(r, 40)); } }

const meta = { id, title: 'Understanding Causal Reasoning — Test Paper', size: 12500, imported: Date.now() };
function fixturePdf() {
  const lines = [
    ['1 Introduction','Understanding causal reasoning requires more than correlation.','A common cause can affect both treatment and outcome.','The research question is how to distinguish association from intervention.','This sample is fictional test material, not a scientific publication.'],
    ['2 Methods','2.1 Adjustment','The method adjusts for measured common causes.','Exchangeability is a necessary assumption for the proposed interpretation.','The adjustment procedure combines evidence across observed groups.','3 Results','The estimated effect is uncertain and depends on the stated assumptions.','These limitations motivate careful checks against the original evidence.']
  ];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'];
  for (let i=0;i<2;i++) {
    const content = 'BT /F1 15 Tf 45 730 Td 23 TL ' + lines[i].map((line,n) => (n ? 'T* ' : '') + '(' + line + ') Tj').join(' ') + ' ET';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents ${4+i*2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let text='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((obj,i) => { offsets.push(Buffer.byteLength(text)); text+=`${i+1} 0 obj\n${obj}\nendobj\n`; });
  const start=Buffer.byteLength(text); text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n` + offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}
const pdf = fixturePdf(); await writeFile(path.join(out,'fixture.pdf'),pdf);
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context = await browser.newContext({ viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true });
await context.route('https://appassets.androidplatform.net/**',async route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.startsWith('/papers/')) return route.fulfill({contentType:pathname.endsWith('.pdf')?'application/pdf':'application/octet-stream',body:pathname.endsWith('.docx')?Buffer.from(docxFixture()):pathname.endsWith('.doc')?Buffer.from(docFixture()):pdf});
  if (!pathname.startsWith('/assets/') || pathname.includes('..')) return route.abort();
  try { await route.fulfill({body:await readFile(path.join(root,'android/assets',pathname.slice(8))),contentType:pathname.endsWith('.html')?'text/html':pathname.endsWith('.css')?'text/css':/\.(m?js)$/.test(pathname)?'text/javascript':pathname.endsWith('.wasm')?'application/wasm':'application/octet-stream'}); }
  catch { await route.abort(); }
});
await context.exposeBinding('testNative', async (_source,req) => {
  switch(req.op) {
    case 'importSummary': return {name:'ChatGPT-summary.txt',base64:Buffer.from('外部总结：本文讨论因果推断、共同原因与调整方法，方法成立需要交换性条件，结果必须结合原文解释。').toString('base64')};
    case 'translationConfig':return translationConfig;
    case 'saveTranslationConfig':translationConfig={...translationConfig,libreEndpoint:req.config.libreEndpoint,tencentRegion:req.config.tencentRegion};for(const name of ['youdao','baidu','tencent','lara']){for(const field of [name,name+'Id']){if(req.config[name+'Clear'])translationConfig[field+'HasKey']=false;else if(req.config[field+'Key'])translationConfig[field+'HasKey']=true;}}return translationConfig;
    case 'translate':translationCalls++;if(failTranslation){failTranslation=false;throw new Error('模拟翻译服务不可用');}return {text:'译文：研究需要对照原文，解释因果条件。'};
    case 'storageInfo': return {storage:customStorage?'primary:Documents/Papers/PaperLibrary':'/data/user/0/org.paperassistant.mobile/files/PaperLibrary',custom:customStorage};
    case 'storageChoose': customStorage=true;return {storage:'primary:Documents/Papers/PaperLibrary',custom:true};
    case 'storageDefault': customStorage=false;return {storage:'/data/user/0/org.paperassistant.mobile/files/PaperLibrary',custom:false};
    case 'list': return {papers:[...library.values()],errors:[],storage:'/data/user/0/org.paperassistant.mobile/files/PaperLibrary'};
    case 'import': { const item = nextImport==='pdf'?meta:{...meta,id:nextImport==='docx'?wordId:docId,title:'Word 阅读测试 '+nextImport,format:nextImport}; library.set(item.id,item); imported=true;return {papers:[item],errors:[]}; }
    case 'delete': library.delete(req.paperId);files.delete(req.paperId);if(job.paperId===req.paperId){job={status:'none'};checkpoints=[];graphInput={};}return true;
    case 'load': {const item=library.get(req.paperId);return files.get(req.paperId) || {version:1,...item,rawText:'',overview:'',threads:[]};}
    case 'save': {
      const current = files.get(req.paperId);
      if (current && (current.graphRevision || 0) !== (req.paper.graphRevision || 0)) for (const key of graphFields) {
        if (key in current) req.paper[key] = current[key]; else delete req.paper[key];
      }
      files.set(req.paperId,copy(req.paper));if(library.has(req.paperId))library.set(req.paperId,{...library.get(req.paperId),categories:copy(req.paper.categories||[])});return true;
    }
    case 'graphStart': {
      activeId=req.paperId; if (!req.resume) { graphInput = graphSourceOverride?{rawText:graphSourceOverride,pageRanges:[{pageIndex:0,start:0,end:graphSourceOverride.length}]}:{}; checkpoints = []; }
      if (worker && !worker.isClosed()) await worker.close();
      job = {status:'running',paperId:activeId,runId:String(Date.now()),updated:Date.now(),message:'正在准备后台建图…'};
      worker = await context.newPage();worker.on('pageerror',e=>errors.push('Worker: '+e.message));
      await worker.goto('https://appassets.androidplatform.net/assets/graph-worker.html');return copy(job);
    }
    case 'graphStatus': return job.paperId===req.paperId?copy(job):{status:'none'};
    case 'graphData': return Object.fromEntries(graphFields.filter(k=>k in files.get(req.paperId)).map(k=>[k,copy(files.get(req.paperId)[k])]));
    case 'graphForget': job={status:'none'};graphInput={};checkpoints=[];return true;
    case 'graphStop': {
      await worker.close(); job={...job,status:'stopped',message:'建图已停止，可从已完成批次继续',updated:Date.now()}; return true;
    }
    case 'jobInput': return {paper:{graphBuildMode:files.get(activeId)?.graphBuildMode,graphSummary:files.get(activeId)?.graphSummary,...copy(graphInput),id:activeId,title:library.get(activeId).title,format:library.get(activeId).format},config:fixtureConfig};
    case 'jobExtracted': graphInput=copy(req.paper);return true;
    case 'jobProgress': job.message=req.message;job.updated=Date.now();return true;
    case 'jobComplete': {
      files.set(activeId,{...files.get(activeId),...req.result,graphRevision:(files.get(activeId).graphRevision||0)+1});
      job={...job,status:'done',message:'全文知识图谱已保存',updated:Date.now()};return true;
    }
    case 'jobError': checkpoints=checkpoints.slice(0,req.retryIndex);job={...job,status:'error',message:req.message,updated:Date.now()};return true;

    case 'getConfig': case 'saveConfig':return {endpoint:'https://fixture.invalid/v1',model:'fixture',hasKey:true};
    case 'export':return true;
    case 'cancel':return true;
    case 'model': {
      const workerCall = req.index !== undefined;
      if (workerCall && req.index === failGraphAt) { failGraphAt = null; throw new Error('模拟网络中断'); }
      const fingerprint = JSON.stringify(req.messages);
      if (workerCall && checkpoints[req.index]?.fingerprint === fingerprint) { replayed++; return copy(checkpoints[req.index].response); }
      if (workerCall && holdGraph) { await new Promise(resolve => releaseGraph = resolve); }
      modelCalls++; const system=req.messages[0].content, user=req.messages.at(-1).content; let content;
      if(system.includes('一次完成章节/小节/自然段识别')) {
        const lines=[...user.matchAll(/\[L(\d+)\] ([\s\S]*?)(?=\[L\d+\]|$)/g)]; let chapter='1 Introduction',subsection='';
        content={brief:'从关联问题出发，通过调整方法分析因果解释的前提，指出证据和不确定性。',nodes:lines.map(m=>{if(m[2].trim()==='2 Methods'){chapter='2 Methods';subsection='';}if(m[2].trim()==='2.1 Adjustment')subsection='2.1 Adjustment';if(m[2].trim()==='3 Results'){chapter='3 Results';subsection='';}return {a:+m[1],b:+m[1],c:chapter,s:subsection,k:'本段解释混杂、调整与因果结论的适用条件。',w:2,t:[['confounder','同时影响处理与结局的共同原因']],r:[]};})};
      } else if(system.includes('综合每批大纲') || system.includes('合并这些局部要义')) content={brief:'研究问题、方法与结论由原文串联，因果解释需满足适用条件。',links:[]};
      else content='## 直接回答\n这是模拟模型返回的测试回答。混杂因素同时影响处理与结局。\n## 对照原文\n请结合所选段落和原文判断调整假设。';
      if(content?.nodes && files.get(activeId)?.graphBuildMode==='summary'){
        content.nodes[0].k='必须核对交换性条件，结论不能超出证据。'.repeat(20)+String.raw`\(P(y\mid do(x))\)`;
        content.nodes[0].w='2';content.nodes[0].t=[{name:'exchangeability',definition:'交换性条件'}];
      }
      const response = {choices:[{message:{content:typeof content==='string'?content:JSON.stringify(content)},finish_reason:'stop'}]};
      if (workerCall) checkpoints[req.index] = {fingerprint,response:copy(response)};
      return response;
    }
    default:throw new Error('Unknown op '+req.op);
  }
});
await context.addInitScript(()=>{Promise.withResolvers=undefined;window.PaperNative={post:text=>{const req=JSON.parse(text);window.testNative(req).then(value=>window.nativeReply({id:req.requestId,value}),e=>window.nativeReply({id:req.requestId,error:e.message}));}};});
let page; async function openUI() { page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>acceptDialog?d.accept():d.dismiss());await page.goto('https://appassets.androidplatform.net/assets/index.html'); }
await openUI();
const workerCompatibility = await page.evaluate(() => new Promise((resolve, reject) => {
  const url = location.origin + '/assets/pdf.worker.mjs';
  const source = `Promise.withResolvers=undefined;import(${JSON.stringify(url)}).then(()=>postMessage(typeof Promise.withResolvers)).catch(e=>postMessage('error:'+e.message))`;
  const probe = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
  const timer = setTimeout(() => { probe.terminate(); reject(new Error('PDF worker compatibility timeout')); }, 10000);
  probe.onmessage = event => {
    if (event.data === 'function') { clearTimeout(timer); probe.terminate(); resolve(event.data); }
    else if (typeof event.data === 'string' && event.data.startsWith('error:')) { clearTimeout(timer); probe.terminate(); reject(new Error(event.data)); }
  };
  probe.onerror = event => { clearTimeout(timer); probe.terminate(); reject(new Error(event.message)); };
}));
assert.equal(workerCompatibility, 'function');
async function idle(){await page.waitForFunction(()=>document.getElementById('progress').hidden);}
try {
  await page.locator('#library-list .empty').waitFor();await page.screenshot({path:path.join(out,'01-library-empty.png')});
  await page.click('#import-pdf');await page.locator('.paper-card').waitFor();await page.click('[data-classify]');await page.fill('#category-new','因果推断');await page.click('#category-save');await idle();
  assert.deepEqual(files.get(id).categories,['因果推断']);await page.click('[data-category="因果推断"]');assert.equal(await page.locator('.paper-card').count(),1);await page.click('.paper-card');
  await page.locator('.textLayer span').first().waitFor();await idle();
  assert.ok((await page.locator('.tabs').boundingBox()).height<=34,'paper tabs should leave more room for reading');
  assert.equal(await page.locator('#reader-tools').evaluate(el=>el.open),false);assert.equal(await page.locator('#annotation-drawer').isVisible(),false);assert.equal(await page.locator('#annotation-drawer').evaluate(el=>el.parentElement.classList.contains('reader-tool-body')),true);await page.click('#reader-tools>summary');assert.equal(await page.locator('#reader-tools').evaluate(el=>el.open),true);
  assert.equal(await page.locator('#page-total').textContent(),'2');
  await page.setViewportSize({width:1180,height:720});await page.waitForFunction(()=>parseFloat(document.querySelector('#pdf-host canvas').style.width)>800);await page.selectOption('#font-render-mode','path');await idle();await page.waitForFunction(()=>document.getElementById('pdf-host').dataset.fontMode==='path');
  const tabletGlyph=await page.locator('.textLayer span').first().evaluate(el=>({color:getComputedStyle(el).color,fill:getComputedStyle(el).webkitTextFillColor,colorPriority:el.style.getPropertyPriority('color'),fillPriority:el.style.getPropertyPriority('-webkit-text-fill-color')}));
  assert.match(tabletGlyph.color,/rgba\([^)]*, 0\)|transparent/);assert.match(tabletGlyph.fill,/rgba\([^)]*, 0\)|transparent/);assert.equal(tabletGlyph.colorPriority,'important');assert.equal(tabletGlyph.fillPriority,'important');
  await page.screenshot({path:path.join(out,'02-tablet-landscape.png')});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>parseFloat(document.querySelector('#pdf-host canvas').style.width)<500);await page.selectOption('#font-render-mode','auto');await idle();await page.waitForFunction(()=>document.getElementById('pdf-host').dataset.fontMode==='web');
  const pixels = await page.locator('#pdf-host canvas').evaluate(c=>({width:c.width,cssWidth:parseFloat(c.style.width)}));
  assert.ok(pixels.width / pixels.cssWidth > 2.9, 'PDF must render at real phone density');
  await page.click('#zoom-in');await idle();
  const enlarged = await page.locator('#pdf-host canvas').evaluate(c=>c.width);assert.ok(enlarged>pixels.width);
  await page.click('#zoom-out');await idle();
  await page.selectOption('#reading-mode','scroll');await idle();
  assert.equal(await page.locator('.page-shell').count(),2);
  await page.locator('#pdf-host').evaluate(el=>{el.scrollTop=el.querySelector('[data-page="2"]').offsetTop;});
  await page.waitForFunction(()=>document.getElementById('page-number').value==='2');
  await page.click('#prev-page');await idle();
  await page.selectOption('#reading-mode','paged');await idle();
  // Verify native browser touch dispatch, live midpoint anchoring, and final committed pixels.
  const touch=await context.newCDPSession(page);
  const before=await page.locator('.pdf-page').evaluate(el=>{const host=document.getElementById('pdf-host').getBoundingClientRect(),r=el.getBoundingClientRect();return {x:190,y:host.top+130,rx:(190-r.left)/r.width,ry:(host.top+130-r.top)/r.height};});
  const sendTouch=async(type,x,y,distance)=>touch.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:x-distance/2,y,id:1},{x:x+distance/2,y,id:2}]});
  await sendTouch('touchStart',before.x,before.y,100);await sendTouch('touchMove',before.x+30,before.y+20,180);
  const during=await page.locator('.pdf-page').evaluate((el,p)=>{const r=el.getBoundingClientRect();return {x:r.left+r.width*p.rx,y:r.top+r.height*p.ry};},before);
  assert.ok(Math.abs(during.x-(before.x+30))<1&&Math.abs(during.y-(before.y+20))<1,'content must follow the moving finger midpoint live');
  await sendTouch('touchEnd',0,0,0);await page.waitForFunction(()=>document.getElementById('zoom-fit').textContent==='180%');
  const after=await page.locator('.pdf-page').evaluate((el,p)=>{const r=el.getBoundingClientRect();return {x:r.left+r.width*p.rx,y:r.top+r.height*p.ry};},before);
  assert.ok(Math.abs(after.x-(before.x+30))<2&&Math.abs(after.y-(before.y+20))<2,'zoom commit must not jump away from the selected area');
  const panBefore=await page.locator('.pdf-page').boundingBox();
  await sendTouch('touchStart',220,before.y+20,100);await sendTouch('touchMove',240,before.y+50,100);
  const panDuring=await page.locator('.pdf-page').boundingBox();assert.ok(Math.abs(panDuring.x-panBefore.x-20)<1&&Math.abs(panDuring.y-panBefore.y-30)<1,'two-finger drag must move without zoom');
  await sendTouch('touchEnd',0,0,0);await page.waitForFunction(()=>!document.querySelector('.pdf-stack').style.transform&&document.querySelector('.textLayer span'));
  assert.ok(await page.locator('#pdf-host').evaluate(el=>el.scrollWidth>el.clientWidth));
  await page.click('#zoom-fit');await idle();
  await page.screenshot({path:path.join(out,'02-reader.png')});
  await page.click('#next-page');await idle();assert.equal(await page.inputValue('#page-number'),'2');
  await page.evaluate(()=>{const node=document.querySelectorAll('.textLayer span')[2].firstChild;const range=document.createRange();range.selectNodeContents(node);const sel=getSelection();sel.removeAllRanges();sel.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.locator('#selection-action').waitFor({state:'visible'});
  await page.screenshot({path:path.join(out,'02b-selection.png')});
  await page.click('#selection-action');assert.equal(await page.locator('#reader-panel').isVisible(),true);
  const expanded=await page.locator('#selection-hint').textContent();assert.ok(expanded.includes('整段'));
  await page.click('#annotate-selection');await page.click('[data-highlight-color="green"]');await page.fill('#annotation-note','这里是方法成立所需的条件。');await page.click('#annotation-save');await idle();
  assert.equal(files.get(id).annotations.length,1);assert.equal(files.get(id).annotations[0].color,'green');assert.ok(files.get(id).annotations[0].rects.length>0);assert.ok(await page.locator('.saved-highlight-layer i').count()>0);
  await page.locator('#annotation-drawer>summary').click();assert.ok((await page.locator('#annotation-list').innerText()).includes('这里是方法成立所需的条件'));
  await page.click('#translate-selection');await page.waitForFunction(()=>document.getElementById('translation-status').textContent.includes('翻译完成'));
  const callsAfterTranslation=translationCalls;assert.ok(callsAfterTranslation>0);
  const translationFont=await page.locator('#translation-output').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await page.click('#translation-larger');assert.ok(await page.locator('#translation-output').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>translationFont);
  const paneHeight=await page.locator('#translation-panel').evaluate(el=>el.clientHeight);
  const resize=await page.locator('#translation-resize').boundingBox();await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2-50,{steps:5});await page.mouse.up();
  assert.ok(await page.locator('#translation-panel').evaluate(el=>el.clientHeight)>paneHeight);
  await page.screenshot({path:path.join(out,'02c-translation.png')});
  await page.click('#translation-close');assert.equal(await page.locator('#translation-panel').isVisible(),false);
  await page.click('#translate-selection');await page.waitForFunction(()=>document.getElementById('translation-status').textContent.includes('已保存译文'));
  assert.equal(translationCalls,callsAfterTranslation,'repeat translation must use cache');
  await page.selectOption('#translation-provider','libre');failTranslation=true;await page.click('#translate-selection');await page.locator('#translation-ai').waitFor({state:'visible'});
  await page.click('#translation-ai');await page.waitForFunction(()=>document.getElementById('translation-status').textContent.includes('翻译完成'));
  assert.ok(files.get(id).translations.some(t=>t.complete&&t.provider==='ai'));
  await page.click('#translation-close');
  await page.click('#read-selection');await page.locator('#chat-panel').waitFor({state:'visible'});await idle();
  assert.ok((await page.locator('#messages').textContent()).includes('模拟模型返回'));
  await page.screenshot({path:path.join(out,'03-close-reading.png')});
  assert.equal(await page.locator('.chat-tools').evaluate(el=>el.open),false);await page.click('.chat-tools>summary');
  const sessionCount=files.get(id).threads.length;
  await page.click('#new-full');await idle();await page.fill('#question','draft to delete');await page.locator('#question').blur();await page.click('#delete-thread');await idle();
  assert.equal(files.get(id).threads.length,sessionCount);assert.ok(!files.get(id).threads.some(t=>t.draft==='draft to delete'));
  await page.selectOption('#threads',files.get(id).threads.find(t=>t.messages.length).id);
  holdGraph = true;
  await page.click('.paper-tools summary');await page.click('#build-graph');await idle();
  await until(()=>Boolean(releaseGraph));
  await page.click('[data-tab="reader"]');
  await page.click('#prev-page');await idle();assert.equal(await page.inputValue('#page-number'),'1');
  await page.click('#text-mode');await page.locator('.reflow').waitFor();await idle();
  assert.equal(await page.locator('#next-page').isEnabled(),true);
  const beforeFont=await page.locator('.reflow').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await page.click('#zoom-in');await idle();assert.ok(await page.locator('.reflow').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>beforeFont);await page.click('#zoom-fit');await idle();
  await page.screenshot({path:path.join(out,'03b-read-while-building.png')});
  // Destroy the entire reader UI. Its independent worker must finish and retain progress.
  await page.close(); holdGraph = false; releaseGraph();
  await until(()=>job.status==='done' || job.status==='error'); assert.equal(job.status,'done',job.message);
  assert.ok(files.get(id).graph?.paragraphs.length>2);assert.equal(files.get(id).readingPage,1);
  const messagesBefore = files.get(id).threads.reduce((n,t)=>n+t.messages.length,0);
  assert.ok(messagesBefore >= 2);
  await openUI();await page.locator('.paper-card').waitFor();await page.click('.paper-card');await idle();
  await page.click('#reader-tools>summary');
  assert.equal(await page.inputValue('#page-number'),'1');
  assert.equal(await page.locator('#annotation-count').textContent(),'1 条');await page.locator('#annotation-drawer>summary').click();await page.locator('[data-edit-annotation]').click();await page.waitForFunction(()=>document.getElementById('page-number').value==='2');assert.ok(await page.locator('.saved-highlight-layer i').count()>0,'saved highlight must survive reopening');await page.click('#annotation-close');await page.click('#prev-page');await idle();
  await page.waitForFunction(()=>document.getElementById('graph-progress-text').textContent.includes('已保存'));
  assert.equal(await page.locator('#reader-panel').isVisible(),true,'Completion must not force a tab switch');
  await page.locator('#graph-dismiss').click();await idle();assert.equal(await page.locator('#graph-progress').isVisible(),false);
  await page.click('#back-library');await idle();await page.click('.paper-card');await idle();
  await page.click('#reader-tools>summary');
  assert.equal(await page.locator('#graph-progress').isVisible(),false,'dismissed completion must stay hidden after reopening');
  const requestsBeforeReopenCache=modelCalls+translationCalls;
  await page.click('#next-page');await idle();
  await page.evaluate(()=>{const node=[...document.querySelectorAll('.textLayer span')].find(el=>el.textContent.includes('The method adjusts')).firstChild;const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
  await page.click('#translate-selection');await page.waitForFunction(()=>document.getElementById('translation-status').textContent.includes('已保存译文'));
  assert.equal(modelCalls+translationCalls,requestsBeforeReopenCache,'saved translation must survive reopening without a network request');
  await page.click('#translation-close');await page.click('#prev-page');await idle();
  await page.click('[data-tab="graph"]');
  await page.locator('#graph-panel').waitFor({state:'visible'});
  await page.click('#graph-expand');
  await page.screenshot({path:path.join(out,'04-knowledge-tree.png')});
  // A failed regeneration keeps the last good tree. Resume replays completed batches.
  graphSourceOverride=Array.from({length:100},(_,i)=>`Evidence ${i} ${'source condition '.repeat(30)}\n`).join('');
  failGraphAt = 1;
  await page.click('[data-tab="chat"]');await page.click('.chat-tools>summary');await page.click('.paper-tools summary');await page.click('#build-graph');
  await until(()=>job.status==='error');assert.equal(files.get(id).graphRevision,1);
  assert.equal(await page.locator('#graph-dismiss').isVisible(),false,'errors must remain visible');
  await page.locator('#graph-resume').waitFor({state:'visible'});await page.click('#graph-resume');
  await until(()=>job.status==='done');assert.equal(files.get(id).graphRevision,2);assert.ok(replayed>=1);
  graphSourceOverride='';
  await page.waitForFunction(()=>!document.getElementById('graph-view').hidden);
  await page.click('#graph-view');
  await page.locator('[data-node]').first().evaluate(el=>el.click());await page.locator('#chat-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('#clear-paragraph').isVisible(),true);
  await page.click('#clear-paragraph');await idle();assert.ok(files.get(id).graph.paragraphs[0].cacheCleared);
  if (!(await page.locator('.paper-tools').evaluate(el=>el.open))) await page.click('.paper-tools summary');
  await page.click('#clear-full');await idle();assert.equal(files.get(id).graph,null);
  await page.click('#threads');await page.selectOption('#threads',(await page.locator('#threads option').all()).length>1?await page.locator('#threads option').nth(1).getAttribute('value'):await page.locator('#threads option').first().getAttribute('value'));
  // Select the previous actual question-bearing session, then clear only that history.
  const withMessages=files.get(id).threads.find(t=>t.messages.length);
  await page.selectOption('#threads',withMessages.id);await page.click('#clear-messages');await idle();
  assert.equal(files.get(id).threads.find(t=>t.id===withMessages.id).messages.length,0);
  await page.click('#back-library');await idle();await page.click('.paper-card');await idle();
  assert.equal(await page.inputValue('#page-number'),'1');
  await page.click('#back-library');await idle();await page.click('#open-settings');
  for(const service of ['youdao','baidu','tencent','lara']){
    assert.equal(await page.locator('#translation-provider option[value="'+service+'"]').count(),1);
    await page.locator('.translation-credentials').filter({has:page.locator('#'+service+'-id')}).locator('summary').click();
    await page.fill('#'+service+'-id','fixture-id');await page.fill('#'+service+'-key','fixture-secret');
  }
  await page.locator('#translation-settings button[type="submit"]').click();await idle();
  for(const service of ['youdao','baidu','tencent','lara']){assert.equal(await page.inputValue('#'+service+'-key'),'');assert.ok(translationConfig[service+'HasKey']&&translationConfig[service+'IdHasKey']);}
  await page.check('#baidu-clear');await page.locator('#translation-settings button[type="submit"]').click();await idle();assert.equal(translationConfig.baiduHasKey,false);assert.equal(translationConfig.baiduIdHasKey,false);assert.equal(translationConfig.youdaoHasKey,true);
  await page.screenshot({path:path.join(out,'10-translation-providers.png')});

  await page.locator('#storage-current').waitFor({state:'visible'});await page.click('#choose-storage');await idle();
  assert.ok((await page.locator('#storage-current').textContent()).includes('primary:Documents/Papers'));
  assert.ok(files.get(id).threads.length>0);await page.screenshot({path:path.join(out,'05-storage-settings.png')});
  await page.click('#default-storage');await idle();assert.equal(customStorage,false);
  await page.click('#close-settings');
  nextImport='docx';await page.click('#import-pdf');await idle();await page.click(`[data-paper="${wordId}"]`);await idle();
  await page.click('#reader-tools>summary');
  await page.locator('.word-page h1').waitFor();assert.ok((await page.locator('.word-page').innerText()).includes('研究问题'));
  await page.click('#next-page');await idle();await page.locator('.word-page table').waitFor();
  assert.ok((await page.locator('.word-page table').innerText()).includes('实验组 42'));
  const wordFont=await page.locator('.word-page').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  await page.click('#zoom-in');await idle();assert.ok(await page.locator('.word-page').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))>wordFont);
  await page.screenshot({path:path.join(out,'06-word.png')});
  await page.click('[data-tab="graph"]');await page.click('#graph-create-direct');await until(()=>job.status==='done');
  assert.ok(files.get(wordId).rawText.includes('实验组 42'));assert.equal(files.get(wordId).graph.stats.calls,1);
  await page.click('#back-library');await idle();
  nextImport='doc';await page.click('#import-pdf');await idle();await page.click(`[data-paper="${docId}"]`);await idle();
  assert.ok((await page.locator('.word-page').innerText()).includes('采用对照与调整方法'));
  const beforeLocalBuild=modelCalls;
  await page.click('[data-tab="chat"]');if(!await page.locator('.chat-tools').evaluate(el=>el.open))await page.locator('.chat-tools > summary').click();if(!await page.locator('.paper-tools').evaluate(el=>el.open))await page.locator('.paper-tools > summary').click();await page.click('#import-summary');await idle();await until(()=>job.status==='done');await page.waitForFunction(()=>document.querySelector('#graph-progress-text').textContent.includes('已保存'));
  assert.equal(files.get(docId).graphSummary.name,'ChatGPT-summary.txt');assert.equal(files.get(docId).graph.importedSummary.name,'ChatGPT-summary.txt');
  assert.equal(modelCalls,beforeLocalBuild,'imported navigation must make zero model requests');assert.equal(files.get(docId).graph.stats.calls,0);assert.ok(files.get(docId).graph.navigation.nodes.length>0);
  await page.click('[data-tab="graph"]');assert.ok((await page.locator('#graph-content').innerText()).includes('来自导入总结'));await page.screenshot({path:path.join(out,'09-imported-summary.png')});
  await page.locator('[data-navigation]').first().evaluate(el=>el.click());await page.locator('#chat-panel').waitFor({state:'visible'});
  assert.ok(files.get(docId).threads.some(t=>t.navigationNodeId));
  if(!await page.locator('.chat-tools').evaluate(el=>el.open))await page.locator('.chat-tools>summary').click();
  if(!await page.locator('.paper-tools').evaluate(el=>el.open))await page.locator('.paper-tools>summary').click();
  await page.click('#rebuild-summary');await idle();await until(()=>job.status==='done');assert.equal(modelCalls,beforeLocalBuild);

  await page.click('#back-library');await idle();
  acceptDialog=false;await page.click(`[data-delete="${wordId}"]`);await idle();assert.ok(library.has(wordId));
  acceptDialog=true;await page.click(`[data-delete="${wordId}"]`);await idle();assert.ok(!library.has(wordId));assert.ok(!files.has(wordId));assert.ok(files.has(id));
  // Deleting a paper with a running background task must first stop the worker.
  await page.click(`[data-paper="${id}"]`);await idle();holdGraph=true;releaseGraph=null;
  await page.click('[data-tab="graph"]');await page.click('#graph-create-direct');await until(()=>Boolean(releaseGraph));
  await page.click('#back-library');await idle();await page.click(`[data-delete="${id}"]`);await idle();
  assert.ok(!library.has(id));assert.ok(!files.has(id));assert.equal(job.status,'none');assert.ok(library.has(docId));
  holdGraph=false;releaseGraph();await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual(errors,[]);
  await writeFile(path.join(out,'ui-report.json'),JSON.stringify({passed:true,modelCalls,replayed,deletedPaperCaches:!files.has(id)&&!files.has(wordId),translationCalls,tests:['tablet landscape transparent PDF text layer','paper categories and filtering','persistent colored highlights and passage notes','annotation page navigation after reopen','translation cache / close / resize / font','translation server failure and AI fallback','reading session deletion','PDF import and library','3x PDF rendering and zoom redraw','PDF selection quick action','page navigation and reflow','selection and follow-up','independent background graph runtime','page navigation during graph generation','reader destroyed while graph completes','saved graph and reading state survive reopen','failed regeneration keeps old tree','resume reuses completed model responses','three independent clear controls','reading position restore','choose storage and switch back','continuous scroll mode','two-finger zoom and reflow zoom','DOCX heading/table/extraction/graph','legacy DOC text','delete cancellation','delete with running graph and caches'],scope:'Desktop Chromium at mobile and tablet landscape viewports; mocked Android bridge and model. Not an Android-device test.'},null,2));
  console.log('Mobile UI smoke passed; screenshots and report in test-results.');
} catch(e) {
  console.log('UI failure:',e.message,'Job:',job);
  if(!page.isClosed()) {await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.log('UI failure state:',await page.locator('body').innerText().catch(()=>''));}
  console.log('Page errors:',errors,'Model calls:',modelCalls);
  throw e;
} finally {await browser.close();}

