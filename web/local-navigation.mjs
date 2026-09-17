import {sourceUnits,makeGraph,validatePlan,sourceFingerprint} from '../../paper-assistant-next/src/graph.mjs';
import {decodeSummary} from './summary-import.mjs';
import {cleanImportedHeading,looksCorruptText} from './text-quality.mjs';

const stop=new Set('the and for with from this that these those have has are was were not into using used also can may our their paper study results method section figure table summary'.split(' '));
export function navigationTerms(text){
  const words=String(text).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|\d+(?:\.\d+)+|[\u4e00-\u9fff]+/g)||[];
  const terms=[];
  for(const word of words){
    if(/^[\u4e00-\u9fff]+$/.test(word)){for(let i=0;i<word.length-1;i++)terms.push(word.slice(i,i+2));}
    else if(!stop.has(word))terms.push(word);
  }
  return [...new Set(terms)];
}
export function headingLevel(text){
  const t=text.trim();if(t.length>160||looksCorruptText(t))return 0;
  const md=t.match(/^(#{1,6})\s+/);if(md)return md[1].length;
  if(/^第[一二三四五六七八九十百\d]+[章篇部分]/.test(t)||/^[一二三四五六七八九十]+[、．.]\s*\S/.test(t))return 1;
  if(/^第[一二三四五六七八九十百\d]+节/.test(t)||/^[（(][一二三四五六七八九十\d]+[)）]/.test(t))return 2;
  const numbered=t.match(/^(\d+(?:\.\d+)*)(?:[.、)]?\s+)([A-Za-z\u4e00-\u9fff].*)$/);
  if(numbered&&!/[。；;]$/.test(t))return Math.min(6,numbered[1].split('.').length);
  if(/^(abstract|introduction|conclusions?|discussion|references|limitations|appendix|摘要|引言|结论|讨论|参考文献|术语表|关键术语|全文概览)$/i.test(t))return 1;
  return 0;
}
function blocks(text){return [...text.matchAll(/[^\n]+(?:\n|$)/g)].filter(m=>m[0].trim()).map(m=>({start:m.index,end:m.index+m[0].length,text:m[0].trim()}));}
export function summaryNavigation(summary){
  const hints=new Map((summary.headings||[]).map(h=>[h.text.trim(),h.level]));
  const nodes=[],stack=[],edges=[];
  for(const b of blocks(summary.text)){
    const explicit=hints.get(b.text)||headingLevel(b.text),cleaned=cleanImportedHeading(b.text),corrupt=looksCorruptText(cleaned);
    const level=corrupt?0:explicit;
    if(level)while(stack.length&&stack.at(-1).level>=level)stack.pop();
    const parent=stack.at(-1)?.id||null,id='g'+(nodes.length+1);
    const node={id,parent,level:level||0,title:corrupt?'[疑似乱码内容，未作为章节标题]':cleaned,start:b.start,end:b.end,candidates:[],corrupt};
    nodes.push(node);if(parent)edges.push({from:parent,to:id,type:'包含'});
    if(level)stack.push(node);
  }
  return {version:2,name:summary.name,fingerprint:sourceFingerprint(summary.text),nodes,edges,terms:[],corruptLines:nodes.filter(node=>node.corrupt).length};
}
function indexDocuments(items){
  const postings=new Map();
  for(let i=0;i<items.length;i++)for(const term of navigationTerms(items[i])){if(!postings.has(term))postings.set(term,[]);postings.get(term).push(i);}
  return {postings,size:items.length};
}
function matches(index,text,limit=3){
  const scores=new Map();
  for(const term of navigationTerms(text).slice(0,160)){
    const entries=index.postings.get(term);if(!entries)continue;
    const weight=Math.log(1+(index.size+1)/(entries.length+1));
    for(const id of entries){const old=scores.get(id)||{id,score:0,hits:0};old.score+=weight;old.hits++;scores.set(id,old);}
  }
  return [...scores.values()].filter(x=>x.hits>=2||x.score>=1.7).sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,limit);
}
function excerpt(text,max){const t=text.trim().replace(/\s+/g,' ');return t.length>max?t.slice(0,max)+'…':t;}
function sourcePlans(units){
  const plans=[];let first=1,chapter='原文开篇',section='',length=0;
  const flush=last=>{if(last>=first)plans.push({first,last,chapter,subsection:section,continuesPrevious:false});first=last+1;length=0;};
  for(let i=0;i<units.length;i++){
    const u=units[i],level=headingLevel(u.text);
    if(level){flush(u.id-1);if(level===1){chapter=u.text.trim().slice(0,180);section='';}else section=u.text.trim().slice(0,240);}
    length+=u.text.length;
    if(!level&&(!u.text.trim()||length>=900||(/[.!?。！？]\s*$/.test(u.text)&&length>=280)))flush(u.id);
  }
  flush(units.at(-1).id);validatePlan({paragraphs:plans},units);return plans;
}
export async function buildLocalNavigation(paper,signal,progress=()=>{}){
  const start=performance.now();let summary=paper.graphSummary;
  if(!summary?.text?.trim())throw new Error('未找到已保存总结，请重新导入');
  if(!paper.rawText?.trim())throw new Error('原文没有可提取文字，暂时无法建立原文导航');
  if(summary.format==='docx'&&summary.base64&&!summary.headings)summary={...await decodeSummary(summary),imported:summary.imported};
  const check=()=>{if(signal?.aborted)throw new Error('已停止');};check();progress('本地整理总结标题与全部条目…');
  const nav=summaryNavigation(summary),units=sourceUnits(paper.rawText),graph=makeGraph(paper.rawText,units,sourcePlans(units));
  graph.kind='local-summary-navigation-v1';graph.model='local';graph.importedSummary={name:summary.name,imported:summary.imported};
  for(const p of graph.paragraphs)Object.assign(p,{summary:'原文节选：'+excerpt(paper.rawText.slice(p.start,p.end),180),importance:'medium',density:'medium',reason:'本地原文分块，未进行 AI 逐段分析',keyQuotes:[]});
  const sourceIndex=indexDocuments(graph.paragraphs.map(p=>{const text=paper.rawText.slice(p.start,p.end);return looksCorruptText(text)?'':text;}));
  const byId=new Map(nav.nodes.map(n=>[n.id,n]));
  for(let i=0;i<nav.nodes.length;i++){
    const n=nav.nodes[i],parent=byId.get(n.parent);
    n.candidates=n.corrupt?[]:matches(sourceIndex,n.title+' '+(parent?.title||''),3).map(m=>({paragraphId:graph.paragraphs[m.id].id,score:Math.round(m.score*100)/100,kind:'关键词候选'}));
    // Definitions are copied only from explicit glossary-style entries.
    const term=n.title.match(/^[-*•]?\s*([^：:\n]{2,70})[：:]\s*(.{4,})$/);
    if(term&&/术语|词汇|glossary|terminology/i.test(parent?.title||''))nav.terms.push({name:term[1],definition:term[2],nodeId:n.id});
    if(i%80===0){progress(`本地关联原文 ${i+1}/${nav.nodes.length}`);await new Promise(resolve=>setTimeout(resolve,0));check();}
  }
  // Link shared distinctive terms across sections, never invent causal relations.
  const lastByTerm=new Map();
  for(const n of nav.nodes){for(const word of navigationTerms(n.title).filter(w=>/^[a-z]/.test(w)&&w.length>=5).slice(0,12)){
    const prev=lastByTerm.get(word);if(prev&&prev.parent!==n.parent){nav.edges.push({from:prev.id,to:n.id,type:'共同术语',term:word});break;}lastByTerm.set(word,n);
  }}
  graph.navigation=nav;
  for(const c of graph.chapters)c.summary='原文位置索引；段落边界按提取文字估计。';
  const roots=nav.nodes.filter(n=>!n.parent&&!n.corrupt);
  graph.narrative='导入总结导航（非原文证据）：\n'+roots.slice(0,30).map(n=>excerpt(n.title,100)).join('\n');
  graph.boundaryNote='来自导入总结：'+summary.name+'。已在本地保留全部总结条目并建立原文索引，建图不调用模型。候选位置按关键词匹配，未匹配的条目不强行关联；纯中文总结与英文原文可能匹配不足。总结、术语与共同关键词关系尚未逐项核对，回答以原文为准。';
  if(nav.corruptLines)graph.boundaryNote+=` 检出 ${nav.corruptLines} 行疑似乱码，内容仍保留，但不作为章节标题或原文定位关键词。`;
  graph.stats={calls:0,inputCharacters:0,outputCharacters:0,sourceCharacters:paper.rawText.length,importedSummaryCharacters:summary.text.length,navigationNodes:nav.nodes.length,matchedNodes:nav.nodes.filter(n=>n.candidates.length).length,elapsedMs:Math.round(performance.now()-start)};
  check();return graph;
}

const indexes=new WeakMap();
export function navigationContext(paper,query,selectedId,broad=false){
  const nav=paper.graph?.navigation;if(!nav)return null;
  let index=indexes.get(nav);if(!index){index=indexDocuments(nav.nodes.map(n=>n.corrupt?'':n.title));indexes.set(nav,index);}
  const matched=matches(index,query,5).map(m=>nav.nodes[m.id]);
  const selected=nav.nodes.find(n=>n.id===selectedId);
  const ids=new Set();const chosen=[];
  const add=n=>{if(n&&!ids.has(n.id)){ids.add(n.id);chosen.push(n);}};
  add(selected);matched.forEach(add);
  for(const n of [...chosen]){add(nav.nodes.find(p=>p.id===n.parent));for(const e of nav.edges.filter(e=>e.type==='共同术语'&&(e.from===n.id||e.to===n.id)).slice(0,2))add(nav.nodes.find(p=>p.id===(e.from===n.id?e.to:e.from)));}
  if(broad){for(const root of nav.nodes.filter(n=>n.level||!n.parent)){add(root);add(nav.nodes.find(n=>n.parent===root.id&&!n.level));}}
  const rows=[],candidateIds=[];let used=0;
  const headings=nav.nodes.filter(n=>!n.corrupt&&(n.level||!n.parent));
  const outline=[];const samples=Math.min(36,headings.length);
  for(let i=0;i<samples;i++){const n=headings[Math.floor(i*headings.length/samples)];outline.push({id:n.id,title:excerpt(n.title,Math.max(20,Math.floor(1600/Math.max(1,samples))))});}
  // Reserve space across the whole document rather than spending it on its first chapter.
  const cap=broad?Math.max(50,Math.min(250,Math.floor(2200/Math.max(1,chosen.length)))):600;
  for(const n of chosen){const text=excerpt(n.title,cap);if(used+text.length>2400)break;rows.push({id:n.id,text,partial:text!==n.title,candidateParagraphs:n.candidates.map(c=>c.paragraphId)});used+=text.length;candidateIds.push(...n.candidates.map(c=>c.paragraphId));}
  return {candidateIds:[...new Set(candidateIds)],material:{sourceKind:'imported-summary',name:nav.name,note:'总结条目仅作理解和检索提示；候选位置不是已核对引用。须根据 originalEvidence 回答。',outline,outlinePartial:samples<headings.length,nodes:rows}};
}
