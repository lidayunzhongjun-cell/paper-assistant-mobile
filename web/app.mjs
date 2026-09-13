import { decodeSummary } from './summary-import.mjs';
import { richText, richAnswer } from './math-render.mjs';
import { mathPrompt, emphasisPrompt } from './math-prompt.mjs';
import './app.css';
import { native, modelWindow, readingStore } from './bridge.mjs';
import { PdfReader } from './pdf-reader.mjs';
import { expandParagraph } from './paragraph-selection.mjs';
import { mountTranslation } from './translation.mjs';
import { makeThread, uid, normalize, endpointURL } from '../../paper-assistant-next/src/core.mjs';
import { compactConversation } from './compact-graph.mjs';
import { callModel } from '../../paper-assistant-next/src/runtime.mjs';
import { graphUsable, location } from '../../paper-assistant-next/src/graph.mjs';
import { cacheControls, fullCachePatch, paragraphCachePatch, persistPatch } from '../../paper-assistant-next/src/cache.mjs';
import { escape } from '../../paper-assistant-next/src/render.mjs';

const $ = id => document.getElementById(id);
let papers = [], paper = null, thread = null, config = {}, controller = null, tab = 'reader', screen = 'library', quote = '', selected = '', draftTimer, toastTimer;
let selectionOverride = null, selectedPage = 1;
let graphTask = null, graphPollBusy = false, graphSeen = '', graphStarting = false;
const legacyGraphRepairs = new Set();
const store = readingStore();
const toast = (text, error = false) => { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false; $('toast').classList.toggle('error', error); toastTimer = setTimeout(() => $('toast').hidden = true, error ? 10000 : 5500); };
const progress = text => { $('progress-text').textContent = text; };
const save = () => store.save(paper);
function saveDraft() { if (thread) { thread.draft = $('question').value; return save().catch(e => toast('保存失败：' + e.message, true)); } }
function showScreen(name) {
  screen = name;
  for (const value of ['library', 'paper', 'settings']) $(value + '-screen').hidden = name !== value;
}
function showTab(name) {
  tab = name;
  $('selection-action').disabled = true;
  for (const t of ['reader', 'chat', 'graph']) $(t + '-panel').hidden = name !== t;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'graph') renderGraph();
  if (name === 'reader' && reader.pdf) void reader.refresh().catch(e => toast(e.message, true));
}
function controls() {
  const busy = Boolean(controller);
  document.querySelectorAll('button,input,select,textarea').forEach(el => { el.disabled = busy; });
  $('stop').disabled = false; $('progress').hidden = !busy;
  $('selection-action').disabled = busy || !selected.trim() || Boolean(selectionOverride);
  $('read-selection').disabled = busy || !selected.trim(); $('translate-selection').disabled = busy || !selected.trim();
  if (!paper || !thread) return;
  const c = cacheControls(paper, thread);
  $('clear-full').disabled = busy || !c.canClearFull;
  $('clear-messages').disabled = busy || !c.canClearMessages;
  $('clear-paragraph').hidden = !c.showParagraph;
  $('clear-paragraph').disabled = busy || !c.canClearParagraph;
  $('clear-paragraph').title = c.paragraphHint;
  $('clear-paragraph').textContent = c.paragraphId ? `清除本段缓存 · ${c.paragraphId}` : '清除本段缓存';
  $('build-graph').textContent = graphUsable(paper) ? '重新建立全文知识图谱' : '建立全文知识图谱';
  const building = graphStarting || graphTask?.status === 'running';
  const syncing = graphTask?.status === 'done' && graphSeen !== graphTask.runId + ':' + graphTask.updated;
  $('build-graph').disabled = busy || building || syncing;
  $('import-summary').disabled = busy || building || syncing;
  $('summary-file').textContent = paper.graphSummary ? '已保存总结：' + paper.graphSummary.name : '可使用 ChatGPT 等生成的论文总结';
  $('clear-full').disabled ||= building || syncing;
  $('clear-paragraph').disabled ||= building || syncing;
  $('graph-stop').disabled = !building;
  $('graph-resume').disabled = busy || building;
  $('prev-page').disabled = busy || !reader.pdf || reader.page <= 1;
  $('next-page').disabled = busy || !reader.pdf || reader.page >= reader.pdf.numPages;
}
async function work(label, fn, stoppable = true) {
  if (controller) return;
  controller = new AbortController(); const signal = controller.signal;
  controls(); $('stop').hidden = !stoppable; progress(label);
  try { return await fn(signal); }
  catch (e) { toast(e.message, true); }
  finally { controller = null; controls(); }
}
const reader = new PdfReader($('pdf-host'), (page, count, zoom, mode) => {
  $('zoom-fit').textContent = Math.round(zoom * 100) + '%'; $('reading-mode').value = mode;
  $('text-mode').hidden = Boolean(reader.word);
  $('text-mode').textContent = reader.textMode ? 'PDF 原版' : '文字版';
  $('format-hint').textContent = reader.word ? (reader.format === 'doc' ? 'DOC 纯文字 · 双指缩放' : 'Word 重排阅读页 · 双指缩放') : '双指缩放 · 长按选段';
  $('page-number').value = page; $('page-number').max = count; $('page-total').textContent = count;
  if (paper) { paper.readingPage = page; paper.readingZoom = zoom; paper.readingMode = mode; void save().catch(e => toast(e.message, true)); }
  selected = ''; selectionOverride = null; $('selection-hint').textContent = '长按选中原文，带着上下文精读'; controls();
  $('selection-action').disabled = true;
}, e => toast(e.message,true));
async function refreshLibrary() {
  const result = await native('list'); papers = result.papers.sort((a,b) => b.imported - a.imported);
  $('storage-path').textContent = result.storage;
  if (result.errors.length) toast(result.errors.join('\n'), true);
  renderLibrary();
}
function renderLibrary() {
  $('paper-count').textContent = papers.length + ' 篇';
  const query = $('search').value.trim().toLowerCase();
  const shown = papers.filter(p => p.title.toLowerCase().includes(query));
  $('library-list').innerHTML = shown.length ? shown.map(p => `<div class="paper-row"><button class="paper-card" data-paper="${escape(p.id)}"><span class="paper-mark">${escape((p.format || 'pdf').toUpperCase())}</span><span><strong>${escape(p.title)}</strong><small>${(p.size / 1048576).toFixed(1)} MB · ${new Date(p.imported).toLocaleDateString()}<span>打开阅读 ↗</span></small></span></button><button class="delete-paper" data-delete="${escape(p.id)}" aria-label="删除 ${escape(p.title)}">删除</button></div>`).join('') : `<div class="empty">${query ? '没有找到这篇论文' : '你的第一篇论文，从这里开始。<br>导入 PDF 或 Word，随时继续阅读。'}</div>`;
  for (const b of $('library-list').querySelectorAll('[data-delete]')) b.onclick = () => void deletePaper(b.dataset.delete);
  for (const b of $('library-list').querySelectorAll('[data-paper]')) b.onclick = () => void openPaper(b.dataset.paper);
}
async function deletePaper(id) {
  const meta = papers.find(p => p.id === id); if (!meta || controller) return;
  if (!confirm(`删除“${meta.title}”？将删除当前论文库中的原文、图谱、问答及全部相关缓存；正在进行的建图也会停止。此操作不可撤销。`)) return;
  await work('删除论文与缓存…', async () => {
    await store.flush();
    let status = await native('graphStatus', {paperId:id});
    if (status.status === 'running') {
      await native('graphStop', {paperId:id});
      const deadline = Date.now() + 15000;
      do { await new Promise(resolve => setTimeout(resolve,250)); status = await native('graphStatus', {paperId:id}); }
      while ((status.active || status.status === 'running') && Date.now() < deadline);
    }
    await native('delete', {paperId:id}); await refreshLibrary(); toast('已删除论文及相关缓存。');
  }, false);
}
async function openPaper(id) {
  await work('打开论文…', async () => {
    const loaded = await native('load', { paperId: id });
    if (!Array.isArray(loaded.threads)) throw new Error('问答记录格式异常');
    for (const t of loaded.threads) {
      if (!Array.isArray(t.messages)) throw new Error('会话数据异常，原文件已保留');
      for (const m of t.messages) if (m.status === 'pending') { m.status = 'interrupted'; m.content = '上次请求被中断，可重试。'; }
    }
    paper = loaded; translation.reset();
    graphTask = null; graphSeen = ''; renderGraphTask();
    thread = paper.threads.find(t => t.id === paper.activeThread) || paper.threads[0];
    if (!thread) { thread = makeThread(paper); paper.threads.push(thread); }
    quote = ''; selected = ''; $('question').value = thread.draft || ''; $('paper-title').textContent = paper.title;
    showScreen('paper'); showTab('reader'); renderChat();
    try { await reader.open(paper.id, paper.readingPage || 1, {format:paper.format,mode:paper.readingMode,zoom:paper.readingZoom}); }
    catch (e) { $('pdf-host').textContent = '文档无法打开：' + (e.name === 'PasswordException' ? '此文件有密码，请先解密再导入。' : e.message); throw e; }
    await save();
    void pollGraph();
  }, false);
}
async function selectThread(next) {
  if (controller) return;
  await saveDraft(); thread = next; paper.activeThread = thread.id; quote = ''; $('question').value = thread.draft || '';
  renderChat(); await save().catch(e => toast(e.message, true));
}
function renderChat() {
  if (!thread) return;
  $('threads').innerHTML = paper.threads.map(t => `<option value="${escape(t.id)}">${escape(t.title)}</option>`).join(''); $('threads').value = thread.id;
  $('source-box').hidden = !thread.selection; $('selection-source').textContent = thread.selection || '';
  $('quote-bar').hidden = !quote; $('quote-text').textContent = quote;
  $('messages').innerHTML = thread.messages.length ? thread.messages.map(m => `<article class="message ${m.role}" data-message="${escape(m.id)}"><div class="meta">${m.role === 'user' ? '你' : '精读助手'}${m.starred ? ' · ★ 收藏' : ''}</div><div class="body">${m.role === 'assistant' && m.status === 'done' ? richAnswer(m.content) : escape(m.content).replace(/\n/g, '<br>')}</div>${m.evidence ? `<div class="evidence">${escape(m.evidence)}</div>` : ''}${m.role === 'assistant' ? `<div class="message-actions">${m.status === 'done' ? `<button data-quote="${escape(m.id)}">引用追问</button><button data-star="${escape(m.id)}">${m.starred ? '取消收藏' : '收藏回答'}</button>` : ['error','interrupted'].includes(m.status) ? `<button data-retry="${escape(m.id)}">重试</button>` : ''}</div>` : ''}</article>`).join('') : '<div class="empty">带着问题读，比读完再问更有收获。<br>从原文选段，或直接提出全文问题。</div>';
  for (const b of $('messages').querySelectorAll('[data-quote]')) b.onclick = () => {
    const m = thread.messages.find(m => m.id === b.dataset.quote); const body = b.closest('.message').querySelector('.body'); const sel = getSelection();
    quote = sel && body.contains(sel.anchorNode) && body.contains(sel.focusNode) && sel.toString().trim() ? sel.toString().trim() : m.content;
    $('quote-bar').hidden = false; $('quote-text').textContent = quote; $('question').focus();
  };
  for (const b of $('messages').querySelectorAll('[data-star]')) b.onclick = async () => { const m = thread.messages.find(m => m.id === b.dataset.star); m.starred = !m.starred; renderChat(); await save().catch(e => toast(e.message,true)); };
  for (const b of $('messages').querySelectorAll('[data-retry]')) b.onclick = () => { const m = thread.messages.find(m => m.id === b.dataset.retry); $('question').value = m.retryQuestion || ''; quote = m.retryQuote || ''; void send(); };
  controls();
}
function graphNode(id) {
  const g = paper.graph, p = g.paragraphs.find(p => p.id === id);
  const labels = { high: '高', medium: '中', low: '低' };
  const chapterNodes=g.paragraphs.filter(n=>n.chapterId===p.chapterId);
  const featured=!p.cacheCleared && chapterNodes.filter(n=>n.importance==='high'&&!n.cacheCleared).slice(0,Math.min(3,Math.max(1,Math.ceil(chapterNodes.length*.25)))).some(n=>n.id===id);
  const rel = g.edges.filter(e => e.type !== '包含' && (e.from === id || e.to === id));
  return `<details class="graph-branch ${featured ? 'graph-important' : ''}"><summary>${featured ? '<span class="key-label">重点</span> ' : ''}${escape(id)} · ${p.cacheCleared ? '本段缓存已清除' : richText(p.summary)}</summary><div class="graph-tags">${p.cacheCleared ? '原文仍可阅读与追问' : `重要性 ${labels[p.importance]} / 密度 ${labels[p.density]}`}</div><p>${richText(p.summary)}</p>${p.reason ? `<p class="muted">评判：${richText(p.reason)}</p>` : ''}${p.keyQuotes.map(q => `<blockquote>${richText(q)}</blockquote>`).join('')}${rel.map(e => `<p class="muted">${escape(e.from)} → ${escape(e.to)} · ${escape(e.type)}：${richText(e.reason)}${e.inferred ? '（模型推断）' : ''}</p>`).join('')}<details><summary>查看本段原文</summary><p>${escape(paper.rawText.slice(p.start,p.end))}</p></details><button data-node="${escape(id)}">精读 / 追问这一段</button></details>`;
}
function renderGraph() {
  const root = $('graph-content');
  if (!paper || !graphUsable(paper)) {
    const active = graphTask?.status === 'running';
    root.innerHTML = `<h2>全文树状知识图谱</h2><p class="graph-narrative">按章节、小节、段落梳理论文，把定义、方法、证据和结论连接起来。</p><div class="empty">${active ? '正在后台构建，进度显示在上方。可以继续阅读。' : paper?.graph ? '已有图谱与当前原文不匹配，请重新建立。原问答记录仍保留。' : '尚未保存完整图谱。可点击下方按钮建立；有中断任务时，点击上方“继续建图”。'}</div><button id="graph-create-direct" class="primary" ${active ? 'disabled' : ''}>建立全文知识图谱</button>`;
    $('graph-create-direct').onclick = () => void createGraph().catch(e => toast(e.message,true));
    return;
  }
  const g = paper.graph;
  root.innerHTML = `<div class="eyebrow">全文核心与原文索引</div><h2>树状知识图谱</h2><div class="graph-actions"><button id="graph-expand">展开全部</button><button id="graph-collapse">收起全部</button></div><div class="graph-tags">${g.chapters.length} 章 · ${g.paragraphs.length} 段 · ${g.terms.length} 项术语${g.stats ? ` · 建图 ${g.stats.calls} 次调用` : ''}</div><p class="muted">${escape(g.boundaryNote)}</p><div class="graph-narrative">${richText(g.narrativeInvalidated ? '部分段落已清除，全文串联已失效。其他节点与原文仍可使用。' : g.narrative)}</div>${g.chapters.map(c => `<details class="graph-branch" open><summary>${richText(c.title)}</summary><p>${richText(c.summaryInvalidated ? '章节串联因段落缓存清除而失效。' : c.summary)}</p>${c.children.map(s => s.kind === 'section' ? `<details class="graph-branch" open><summary>${richText(s.title)}</summary>${s.children.map(p => graphNode(p.id)).join('')}</details>` : graphNode(s.id)).join('')}</details>`).join('')}<details class="graph-branch"><summary>章节之间的关系</summary>${g.edges.filter(e => e.inferred && e.from.startsWith('c') && e.to.startsWith('c')).map(e => `<p>${escape(e.from)} → ${escape(e.to)} · ${escape(e.type)}：${richText(e.reason)}（模型推断）</p>`).join('')}</details><details class="graph-branch"><summary>独立附属术语表</summary>${g.terms.map(t => `<div class="term"><strong>${richText(t.name)}</strong><p>${richText(t.definition)}</p><div class="graph-tags">${escape(t.paragraphIds.join(' · '))}</div></div>`).join('')}</details>`;
  $('graph-expand').onclick = () => root.querySelectorAll('details').forEach(d => d.open = true);
  $('graph-collapse').onclick = () => root.querySelectorAll('details').forEach(d => d.open = false);
  root.querySelectorAll('[data-node]').forEach(b => b.onclick = async () => {
    if (controller) return;
    const p = g.paragraphs.find(p => p.id === b.dataset.node), selection = paper.rawText.slice(p.start,p.end);
    let target = paper.threads.find(t => t.paragraphId === p.id && t.selection === selection);
    if (!target) { const page = paper.pageRanges?.find(r => p.start < r.end)?.pageIndex ?? null; target = makeThread(paper, selection, page); target.paragraphId = p.id; target.title = location(g,p); paper.threads.push(target); }
    await selectThread(target); showTab('chat');
  });
  controls();
}
async function ensureText(signal) {
  if (paper.rawText) return;
  const result = await reader.extract(signal, progress); paper.rawText = result.text; paper.pageRanges = result.ranges;
}
async function send() {
  const question = $('question').value.trim(); if (!question || !paper || controller) return;
  if (question.length > 10000 || quote.length > 12000 || thread.selection.length > 18000) { toast('请缩小问题、引用或选段范围后发送。', true); return; }
  await work('准备论文材料…', async signal => {
    config = await native('getConfig'); const target = thread, chosenQuote = quote;
    const answer = { id: uid(), role: 'assistant', content: '正在准备原文与图谱…', status: 'pending', time: Date.now(), retryQuestion: question, retryQuote: chosenQuote };
    try {
      try { await ensureText(signal); } catch (e) { if (signal.aborted) throw e; toast(e.message + ' 本轮使用当前选段。', true); }
      const request = compactConversation(paper, target, question, chosenQuote);
      request.messages[0].content += mathPrompt + emphasisPrompt + (paper.graph?.importedSummary ? ' 当前图谱来源于用户导入的外部 AI 总结，尚未逐项核对。不得把总结或索引对应关系当作原文证据；按本次提供的原文回答，冲突时指出差异，证据不足时明确说明。' : '');
      if (signal.aborted) throw new Error('已停止');
      target.messages.push({ id: uid(), role: 'user', content: request.messages.at(-1).content, status: 'done', time: Date.now() }, answer);
      answer.evidence = request.evidenceLabel + (request.omitted ? ` · ${request.omitted} 条早期消息仅在本地保留` : '');
      target.draft = ''; $('question').value = ''; quote = ''; renderChat(); await save();
      $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight; progress('正在串读原文并回答…');
      answer.content = await callModel(modelWindow, config, request.messages, signal); answer.status = 'done'; target.updated = Date.now();
      await save(); toast('回答已保存，可以继续追问。');
    } catch (e) {
      if (answer.status === 'done') throw new Error('回答已生成，但保存失败，请先保留页面。');
      answer.status = signal.aborted ? 'interrupted' : 'error'; answer.content = e.message;
      if (target.messages.includes(answer)) await save().catch(() => {});
      throw e;
    } finally { renderChat(); }
  });
}
async function createGraph() {
  if (!paper || controller || graphStarting || graphTask?.status === 'running') return;
  config = await native('getConfig');
  if (!confirm(`建立知识图谱会把论文提取文字分批发送到 ${new URL(endpointURL(config.endpoint)).host}，提炼紧凑大纲并可能计费。启动后可继续阅读或把 App 放到后台，通知栏会显示进度。继续？`)) return;
  paper.graphBuildMode = 'original'; await save();
  await startGraph(false);
}
function renderGraphTask() {
  const status = graphTask?.status || 'none';
  const repairableRelations = status === 'error' && /关系指向不存在的段落|缺少说明/.test(graphTask?.message || '');
  $('graph-progress').hidden = status === 'none';
  $('graph-progress-text').textContent = graphTask?.message || '';
  if (status === 'error') $('graph-progress-text').textContent = repairableRelations ? '上次建图因可选关系格式异常而中断；新版会跳过无效关系并保留完整大纲。' : `生成失败${graphTask.stage ? '（' + graphTask.stage + '）' : ''}：${graphTask.message}`;
  $('graph-stop').hidden = status !== 'running';
  $('graph-view').hidden = status !== 'done' || !graphUsable(paper);
  if (status === 'done' && graphUsable(paper)) $('graph-progress-text').textContent = `图谱已保存 · ${paper.graph.chapters.length} 章 / ${paper.graph.paragraphs.length} 段`;
  $('graph-resume').hidden = !['error', 'interrupted', 'stopped'].includes(status);
  $('graph-resume').textContent = repairableRelations ? '修复并继续建图' : '继续建图';
  controls();
}
async function startGraph(resume) {
  if (!paper || graphStarting) return;
  const target = paper;
  graphStarting = true; controls();
  try {
    await saveDraft(); await store.flush();
    const result = await native('graphStart', { paperId: target.id, resume });
    if (paper === target) { graphTask = result; graphSeen = ''; renderGraphTask(); }
    toast('后台建图已启动，可以继续阅读；通知栏可查看进度或停止。');
  } finally { graphStarting = false; controls(); }
}
async function pollGraph() {
  if (!paper || graphPollBusy || graphStarting) return;
  graphPollBusy = true; const target = paper;
  try {
    const status = await native('graphStatus', { paperId: target.id });
    if (paper !== target) return;
    graphTask = status; renderGraphTask();
    if (status.status === 'error' && /关系指向不存在的段落|缺少说明/.test(status.message || '') && !legacyGraphRepairs.has(target.id)) {
      legacyGraphRepairs.add(target.id);
      $('graph-progress-text').textContent = '正在自动修复旧版关系并继续建图…';
      await startGraph(true);
      return;
    }
    const stamp = status.runId + ':' + status.updated;
    // Wait for current Q&A/clear writes; completion must not replace an in-use graph mid-request.
    if (status.status === 'done' && stamp !== graphSeen && !controller) {
      await store.flush();
      const fields = await native('graphData', { paperId: target.id });
      if (paper !== target || controller) return;
      for (const key of ['rawText', 'pageRanges', 'graph', 'overview', 'overviewModel', 'overviewTime', 'graphRevision']) {
        if (key in fields) paper[key] = fields[key]; else delete paper[key];
      }
      graphSeen = stamp; renderGraph(); renderGraphTask();
      // Keep the reader and its current page in place when a graph completes.
    }
  } catch (e) { if (paper === target) $('graph-progress-text').textContent = '读取建图进度失败：' + e.message; }
  finally { graphPollBusy = false; }
}
async function clear(kind) {
  if (controller || !paper) return;
  if (kind !== 'messages' && (graphStarting || graphTask?.status === 'running')) { toast('请先停止当前建图任务再清除缓存。'); return; }
  const c = cacheControls(paper,thread);
  if (kind === 'paragraph' && !c.canClearParagraph) { toast(c.paragraphHint); return; }
  const message = kind === 'full' ? '清除当前论文的全文原文缓存、图谱与术语？原文件和全部问答保留。' : kind === 'messages' ? '清除当前会话的全部问答（包括收藏回答）？缓存、其他会话和草稿保留。' : `清除 ${c.paragraphId} 的分析缓存？原文、其他段落及问答保留；依赖它的章节和全文串联将失效。`;
  if (!confirm(message)) return;
  await work('保存清除结果…', async () => {
    const patch = kind === 'full' ? fullCachePatch() : kind === 'paragraph' ? paragraphCachePatch(paper,thread) : { messages: [], updated: Date.now() };
    await persistPatch(paper, kind === 'messages' ? thread : paper, patch, store);
    if (kind === 'full') {
      await native('graphForget', { paperId: paper.id }); graphTask = null; graphSeen = ''; renderGraphTask();
    }
    if (kind === 'messages') quote = '';
    renderChat(); renderGraph(); toast('已清除并保存。');
  }, false);
}

$('import-pdf').onclick = () => void work('导入论文…', async () => { const result = await native('import'); if (!result) return; await refreshLibrary(); toast(`已处理 ${result.papers.length} 篇论文${result.papers.some(p => p.duplicate) ? '，重复文件已合并' : ''}${result.errors.length ? '\n' + result.errors.join('\n') : ''}`, Boolean(result.errors.length)); }, false);
$('search').oninput = renderLibrary;
$('back-library').onclick = () => void work('保存阅读进度…', async () => { await saveDraft(); await store.flush(); await reader.close(); paper = null; thread = null; translation.reset(); showScreen('library'); await refreshLibrary(); }, false);
$('export-paper').onclick = () => void work('导出论文与阅读数据…', async () => { await saveDraft(); await store.flush(); const done = await native('export', { paperId: paper.id }); if (done) toast('原文、图谱、缓存及问答已一起导出为 ZIP。'); }, false);
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { if (!controller) showTab(b.dataset.tab); });
$('prev-page').onclick = () => void work('翻页…', () => reader.show(reader.page - 1), false);
$('next-page').onclick = () => void work('翻页…', () => reader.show(reader.page + 1), false);
$('page-number').onchange = () => void work('定位页面…', () => reader.show(Number($('page-number').value)), false);
$('zoom-in').onclick = () => void work('放大页面…', () => reader.setZoom(reader.zoom + .25), false);
$('zoom-out').onclick = () => void work('缩小页面…', () => reader.setZoom(reader.zoom - .25), false);
$('zoom-fit').onclick = () => void work('适合屏幕…', () => reader.setZoom(1), false);
$('reading-mode').onchange = () => void work('切换阅读模式…', () => reader.setMode($('reading-mode').value), false);
$('text-mode').onclick = () => void work('切换阅读方式…', async () => { reader.textMode = !reader.textMode; $('text-mode').textContent = reader.textMode ? 'PDF 原版' : '文字版'; await reader.render(); }, false);
function captureSelection() {
  const selection = getSelection();
  if (selection && $('pdf-host').contains(selection.anchorNode) && $('pdf-host').contains(selection.focusNode) && selection.toString().trim()) {
    selected = selectionOverride?.fingerprint === selection.toString() ? selectionOverride.text : selection.toString().trim(); selectedPage = selectionOverride?.fingerprint === selection.toString() ? selectionOverride.page : reader.pageForSelection(selection); if(selectionOverride?.fingerprint !== selection.toString())selectionOverride=null; return selection;
  }
  return null;
}
let selectionFrame=0;
document.addEventListener('selectionchange', () => {
  if(selectionFrame)return;selectionFrame=requestAnimationFrame(()=>{selectionFrame=0;
  if (controller || tab !== 'reader' || screen !== 'paper') return;
  const selection = captureSelection();
  if (selection) {
    $('selection-hint').textContent = selectionOverride ? `已选整段 ${selected.length} 字符${selectionOverride.exact?'':' · 按版式识别，请核对'}` : `已选 ${selected.length} 字符`; controls();
    if(selectionOverride){$('selection-action').disabled=true;return;}
    $('selection-action').disabled = false;
  } else {
    $('selection-action').disabled = true;
  }
  });
});
async function readSelected(immediate = false) {
  captureSelection();
  if (!selected || controller) return;
  if (selected.length > 18000) { toast('选段过长，请选择几个相关段落。', true); return; }
  const source = selected, sourcePage = selectedPage - 1;
  let target = paper.threads.find(t => normalize(t.selection) === normalize(source) && t.pageIndex === sourcePage);
  if (!target) { target = makeThread(paper, source, sourcePage); paper.threads.push(target); }
  await selectThread(target); showTab('chat');
  if (immediate) { $('question').value = '请精读这段：准确翻译，解释推理、全文作用和必要术语。'; await send(); }
}
$('read-selection').onclick = () => void readSelected(true);
$('read-selection').onpointerdown = $('translate-selection').onpointerdown = event => event.preventDefault();
$('selection-action').onpointerdown = event => event.preventDefault();
$('selection-action').onclick = () => {
  if(controller)return;
  try {selectionOverride=expandParagraph(reader,paper);selected=selectionOverride.text;selectedPage=selectionOverride.page;
    $('selection-hint').textContent=`已选整段 ${selected.length} 字符${selectionOverride.exact?'':' · 按版式识别，请核对'}`;
    $('selection-action').disabled=true;controls();
  }catch(e){toast(e.message,true);}
};
const translation=mountTranslation({getPaper:()=>paper,getSelectionText:()=>{captureSelection();return selected;},save:target=>store.save(target),toast});

$('graph-stop').onclick = () => void native('graphStop', { paperId: paper.id }).then(pollGraph).catch(e => toast(e.message, true));
$('graph-view').onclick = () => showTab('graph');
$('graph-resume').onclick = () => void startGraph(true).catch(e => toast(e.message, true));
$('threads').onchange = () => void selectThread(paper.threads.find(t => t.id === $('threads').value));
$('delete-thread').onclick = () => void work('删除阅读会话…',async()=>{
  if(!thread||!confirm(`删除“${thread.title}”及其全部问答、收藏和草稿？论文与图谱保留。`))return;
  clearTimeout(draftTimer);await store.flush();
  const removed=thread,previous=paper.threads,active=paper.activeThread;
  paper.threads=paper.threads.filter(t=>t!==removed);if(!paper.threads.length)paper.threads.push(makeThread(paper));
  thread=paper.threads[0];paper.activeThread=thread.id;
  try{await save();}catch(e){paper.threads=previous;paper.activeThread=active;thread=removed;throw e;}
  quote='';$('question').value=thread.draft||'';renderChat();toast('会话已删除。');
},false);
$('new-full').onclick = async () => { const target = makeThread(paper); paper.threads.push(target); await selectThread(target); };
$('locate-source').onclick = () => { showTab('reader'); if (thread.pageIndex != null) void work('回到原文…', () => reader.show(thread.pageIndex+1), false); };
$('question').oninput = () => { clearTimeout(draftTimer); draftTimer = setTimeout(() => void saveDraft(), 500); };
$('question').onblur = () => void saveDraft();
$('send').onclick = () => void send(); $('build-graph').onclick = () => void createGraph().catch(e => toast(e.message,true));
$('stop').onclick = () => { controller?.abort(); progress('正在停止…'); };
$('cancel-quote').onclick = () => { quote = ''; $('quote-bar').hidden = true; };
for (const b of document.querySelectorAll('[data-prompt]')) b.onclick = () => { $('question').value = b.dataset.prompt; void saveDraft(); $('question').focus(); };
$('clear-full').onclick = () => void clear('full'); $('clear-paragraph').onclick = () => void clear('paragraph'); $('clear-messages').onclick = () => void clear('messages');
$('open-settings').onclick = async () => { try { config = await native('getConfig'); $('endpoint').value = config.endpoint; $('model').value = config.model; $('api-key').value = ''; $('clear-key').checked = false; $('key-status').textContent = config.hasKey ? '已有加密保存的 Key。留空可继续使用。' : '尚未保存 API Key；本地无认证服务可留空。'; await showStorage(); await loadTranslationSettings(); showScreen('settings'); } catch (e) { toast(e.message,true); } };
const translationServices={deepl:'DeepL',libre:'LibreTranslate',youdao:'有道智云',baidu:'百度翻译',tencent:'腾讯云',lara:'Lara'};
async function loadTranslationSettings(){const c=await native('translationConfig');$('libre-endpoint').value=c.libreEndpoint;$('tencent-region').value=c.tencentRegion||'ap-guangzhou';const status=[];
  for(const [service,label] of Object.entries(translationServices)){$(service+'-key').value='';$(service+'-clear').checked=false;const id=$(service+'-id');if(id)id.value='';status.push(label+'：'+(c[service+'HasKey']&&(!id||c[service+'IdHasKey'])?'已配置':'未完整配置'));}
  $('translation-key-status').textContent=status.join(' · ');
}
$('translation-settings').onsubmit=event=>{event.preventDefault();void work('保存翻译设置…',async()=>{const config={libreEndpoint:$('libre-endpoint').value,tencentRegion:$('tencent-region').value};for(const service of Object.keys(translationServices)){config[service+'Key']=$(service+'-key').value;config[service+'Clear']=$(service+'-clear').checked;const id=$(service+'-id');if(id)config[service+'IdKey']=id.value;}await native('saveTranslationConfig',{config});await loadTranslationSettings();toast('翻译设置已保存。');},false);};
async function showStorage() {
  const info = await native('storageInfo');
  $('storage-current').textContent = (info.custom ? '自选目录：' : '默认目录：') + info.storage;
  $('storage-path').textContent = info.storage; $('default-storage').hidden = !info.custom;
}
$('choose-storage').onclick = () => void work('正在选择目录并迁移论文与缓存…', async () => {
  const result = await native('storageChoose'); if (!result) return;
  await refreshLibrary(); await showStorage(); toast('论文与缓存已迁移并校验。后续内容会保存到新目录。');
}, false);
$('default-storage').onclick = () => {
  if (!confirm('将当前论文与缓存迁回 App 默认目录？自选目录保留原副本。')) return;
  void work('正在迁回默认目录并校验…', async () => { await native('storageDefault'); await refreshLibrary(); await showStorage(); toast('已迁回默认目录。'); }, false);
};
$('close-settings').onclick = () => showScreen('library');
$('settings-form').onsubmit = event => { event.preventDefault(); void work('保存模型设置…', async () => {
  endpointURL($('endpoint').value);
  config = await native('saveConfig', { config: { endpoint: $('endpoint').value, model: $('model').value, apiKey: $('api-key').value, clearKey: $('clear-key').checked } });
  $('api-key').value = ''; showScreen('library'); toast('模型设置已保存。');
}, false); };
globalThis.mobilePause = () => { clearTimeout(draftTimer); void saveDraft(); };
globalThis.mobileResume = () => void pollGraph();
document.addEventListener('visibilitychange', () => { if (!document.hidden) void pollGraph(); });
setInterval(() => { if (!document.hidden) void pollGraph(); }, 1500);
let resizeTimer, lastWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0].contentRect.width;
  if (width <= 0 || Math.abs(width - lastWidth) < 1) return;
  lastWidth = width; clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (reader.pdf && tab === 'reader' && !controller) void reader.refresh().catch(e => toast(e.message, true)); }, 180);
}).observe($('pdf-host'));
globalThis.mobileBack = () => {
  if (controller) { if (confirm('任务正在进行，停止当前任务？')) controller.abort(); return; }
  if (screen === 'settings') showScreen('library');
  else if (screen === 'paper') $('back-library').click();
  else toast('阅读记录已保存在本机，可使用系统手势离开。');
};
window.addEventListener('unhandledrejection', e => { toast(e.reason?.message || '操作未完成，请重试。', true); e.preventDefault(); });
window.addEventListener('error', e => toast('界面运行异常：' + e.message, true));
await refreshLibrary().catch(e => toast(e.message,true));

$('import-summary').onclick = () => void work('读取总结文档…', async () => {
  const target = paper; const file = await native('importSummary'); if (!file) return;
  const summary = await decodeSummary(file); config = await native('getConfig');
  if (!confirm(`总结：${summary.name}（${summary.text.length} 字符）\n将关联到《${target.title}》，把总结与原文定位片段发送到 ${new URL(endpointURL(config.endpoint)).host} 梳理图谱。成功后替换旧图谱，原问答保留。继续？`)) return;
  target.graphSummary = summary; target.graphBuildMode = 'summary'; await save(); await startGraph(false);
}, false);
