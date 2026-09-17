import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildCompactGraph,compactConversation} from '../web/compact-graph.mjs';
import {summaryNavigation,navigationContext} from '../web/local-navigation.mjs';
import {graphUsable} from '../../paper-assistant-next/src/graph.mjs';
import {decodeSummary} from '../web/summary-import.mjs';
import {docxFixture} from './word-fixture.mjs';

const signal=new AbortController().signal;
const noNetwork={fetch:()=>{throw new Error('Local navigation must not call a model');}};
const paper={id:'local-test',title:'ToolAgent',graphBuildMode:'summary',rawText:'1 Introduction\nToolAgent performs industrial anomaly detection for unseen products.\n\n2 Method\nToolAgent crops a local patch using region selection. The region score is 0.73.\n\n3 Limitations\nToolAgent assumes stable illumination. RareMarker 729.4 requires recalibration.\n',graphSummary:{name:'AI总结.txt',text:'# ToolAgent 学习指南\n## 1 研究问题\nToolAgent 处理工业异常检测。\n## 2 方法\n区域裁剪（region selection）由 ToolAgent 执行，分数 0.73。\n## 3 局限\n光照稳定（stable illumination）是前提，RareMarker 729.4 要重新校准。\n## 术语表\nregion selection：选择局部区域进行裁剪。\n## 未对应内容\n无关联的地质断层概念与演化理论。'}};
test('imported guide builds offline with all entries and exact original offsets',async()=>{
  const before=JSON.stringify(paper),graph=await buildCompactGraph(noNetwork,{},paper,signal);
  assert.equal(graph.stats.calls,0);assert.equal(graph.stats.inputCharacters,0);assert.ok(graphUsable({...paper,graph}));assert.equal(JSON.stringify(paper),before);
  assert.equal(graph.paragraphs.map(p=>paper.rawText.slice(p.start,p.end)).join(''),paper.rawText);
  assert.deepEqual(graph.navigation.nodes.map(n=>paper.graphSummary.text.slice(n.start,n.end).trim()),paper.graphSummary.text.split('\n'));
  assert.equal(graph.navigation.terms[0].name,'region selection');
  assert.equal(graph.navigation.nodes.at(-1).candidates.length,0,'unmatched items must not invent source locations');
  const method=graph.navigation.nodes.find(n=>n.title.includes('区域裁剪'));
  assert.ok(method.candidates.some(c=>paper.rawText.slice(graph.paragraphs.find(p=>p.id===c.paragraphId).start,graph.paragraphs.find(p=>p.id===c.paragraphId).end).includes('0.73')));
});
test('Word heading styles are preserved alongside complete text',async()=>{
  const summary=await decodeSummary({name:'guide.docx',base64:Buffer.from(docxFixture()).toString('base64')});
  assert.ok(summary.headings.some(h=>h.level===1&&h.text==='第一章 研究问题'));
  const nav=summaryNavigation({...summary,text:'My custom heading\nA paragraph.',headings:[{text:'My custom heading',level:1}]});
  assert.equal(nav.nodes[1].parent,nav.nodes[0].id);
});
test('questions use selected guide material plus real source and related chapter context',async()=>{
  const graph=await buildCompactGraph(noNetwork,{},paper,signal),target={...paper,graph};
  const node=graph.navigation.nodes.find(n=>n.title.includes('光照稳定'));
  const request=compactConversation(target,{selection:'',messages:[],navigationNodeId:node.id,navigationFingerprint:graph.navigation.fingerprint},'这个前提有什么限制');
  const data=JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
  assert.equal(data.secondaryMaterial.sourceKind,'imported-summary');assert.match(JSON.stringify(data.secondaryMaterial),/光照稳定/);assert.match(data.originalEvidence,/stable illumination/);assert.ok(!data.originalEvidence.includes('光照稳定'));
  assert.ok(JSON.stringify(request.messages).length<30000);
  const full=compactConversation(target,{selection:'',messages:[]},'全文核心和局限是什么');
  assert.match(JSON.stringify(full.messages),/研究问题/);assert.match(JSON.stringify(full.messages),/局限/);
});
test('long guide stays complete locally and repeated queries have bounded input',async()=>{
  const input={...paper,rawText:Array.from({length:160},(_,i)=>`${i+1} Topic${i}\nTopic${i} condition${i} ${'Evidence about the method and its limitations. '.repeat(20)}\n\n`).join(''),graphSummary:{name:'long.txt',text:Array.from({length:140},(_,i)=>`## ${i+1} Topic${i}\nTopic${i} condition${i} ${'保留条件、结论、术语和公式。'.repeat(18)}\n`).join('')}};
  const start=performance.now(),graph=await buildCompactGraph(noNetwork,{},input,signal),elapsed=performance.now()-start;
  assert.ok(input.graphSummary.text.length>30000);assert.equal(graph.navigation.nodes.length,280);assert.equal(graph.stats.calls,0);
  const target={...input,graph};for(let i=0;i<3;i++){const request=compactConversation(target,{selection:'',messages:[]},'Topic139 condition139 的条件是什么');assert.ok(JSON.stringify(request.messages).length<30000);assert.match(JSON.stringify(request.messages),/Topic139/);}
  const context=navigationContext(target,'全文核心',null,true);assert.ok(context.material.outlinePartial);assert.ok(context.material.outline.length<=36);
  console.log(JSON.stringify({benchmark:'local summary navigation',sourceCharacters:input.rawText.length,guideCharacters:input.graphSummary.text.length,nodes:graph.navigation.nodes.length,modelCalls:0,elapsedMs:Math.round(elapsed),scope:'Node desktop fixture; not phone timing'}));
});
test('cancellation and missing text fail without overwriting an existing graph',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(buildCompactGraph(noNetwork,{},paper,controller.signal),/已停止/);
  await assert.rejects(buildCompactGraph(noNetwork,{}, {...paper,graphSummary:null},signal),/重新导入/);
  await assert.rejects(buildCompactGraph(noNetwork,{}, {...paper,rawText:''},signal),/原文/);
});
