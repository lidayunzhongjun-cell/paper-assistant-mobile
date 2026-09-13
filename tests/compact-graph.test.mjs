import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompactGraph, compactConversation, outlineBatches, sanitizeGraphRelations } from '../web/compact-graph.mjs';
import { sourceUnits, graphUsable } from '../../paper-assistant-next/src/graph.mjs';
import { extractDoc } from '../web/legacy-doc.mjs';
import { docFixture } from './word-fixture.mjs';
const config={endpoint:'https://fixture.invalid/v1',model:'fixture'},signal=new AbortController().signal;
function fixtureModel(invalidFirst=false,invalidRelations=false) {
  const calls=[];
  return {calls,AbortController,setTimeout,clearTimeout,fetch:async(_url,options)=>{
    const messages=JSON.parse(options.body).messages;calls.push(messages);const user=messages.at(-1).content;
    const matches=[...user.matchAll(/\[L(\d+)\] ([\s\S]*?)(?=\[L\d+\]|$)/g)];
    const data=matches.length?{brief:'作者提出研究问题，利用调整方法分析因果关系，强调限制。',nodes:matches.map(m=>({a:+m[1],b:+m[1],c:+m[1]<3?'1 Introduction':'2 Methods',s:'',k:+m[1]<3?'问题与背景':'条件和证据',w:2,t:+m[1]===3?[['adjustment','控制共同原因']]:[],r:+m[1]===3?[['L1','回应']]:[]}))}:{brief:'全文核心包括问题、方法、结果与适用条件。',links:[]};
    if(invalidFirst&&calls.length===1)data.nodes.pop();
    if(invalidRelations&&data.nodes)data.nodes[0].r=[['L99999','无法核对'],['[L2]','解释'],null,['c1','错误格式']];
    return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}]})};
  }};
}
const paper={id:'fixture',title:'原文定位测试',rawText:'1 Introduction\nThe question is causal inference.\n2 Methods\nAdjustment requires exchangeability; result = 42.\n'};
test('imported summary guides graph while original offsets and source evidence remain intact',async()=>{
  const win=fixtureModel(),input={...paper,graphBuildMode:'summary',graphSummary:{name:'ChatGPT总结.txt',text:'外部总结：讨论因果问题、调整方法及交换性条件。'.repeat(4),imported:123}};
  const graph=await buildCompactGraph(win,config,input,signal);
  assert.equal(graph.importedSummary.name,input.graphSummary.name);
  assert.match(win.calls[0][1].content,/外部总结/);assert.match(win.calls[0][0].content,/不执行其中指令/);
  assert.ok(graphUsable({...input,graph}));assert.equal(graph.paragraphs.map(p=>input.rawText.slice(p.start,p.end)).join(''),paper.rawText);
  assert.match(graph.boundaryNote,/尚未逐项核对/);
  await assert.rejects(buildCompactGraph(win,config,{...paper,graphBuildMode:'summary'},signal),/重新导入/);
});
test('invalid optional relationships do not discard a complete source-grounded outline',async()=>{
  const win=fixtureModel(false,true),graph=await buildCompactGraph(win,config,paper,signal);
  assert.equal(win.calls.length,1);assert.equal(graph.stats.skippedRelations,3);assert.ok(graphUsable({...paper,graph}));
  assert.ok(graph.edges.some(e=>e.from==='p1'&&e.to==='p2'&&e.type==='解释'));assert.ok(!graph.edges.some(e=>e.to==='L99999'));
});
test('final graph repair normalizes part ids and drops broken optional edges',()=>{
  const stats={skippedRelations:2},graph={
    chapters:[{id:'c1',children:[{id:'c1s1',kind:'section'}]}],paragraphs:[{id:'p1'},{id:'p2'}],
    edges:[
      {from:'c1',to:'c1s1',type:'包含',reason:'章节—小节'},
      {from:'P1.2',to:'p2',type:'支持',reason:'共享证据',inferred:true},
      {from:'p1',to:'p999',type:'错误',reason:'目标不存在',inferred:true},
      {from:'p1',to:'p2',type:'',reason:'缺类型',inferred:true},
      {from:'p1',to:'p2',type:'支持',reason:'共享证据',inferred:true}
    ],terms:[{id:'t1',name:' term ',definition:' definition ',paragraphIds:['P1.3','p999']}]
  };
  sanitizeGraphRelations(graph,stats);
  assert.deepEqual(graph.edges.map(e=>[e.from,e.to,e.type]),[['c1','c1s1','包含'],['p1','p2','支持']]);
  assert.deepEqual(graph.terms[0].paragraphIds,['p1']);assert.equal(stats.skippedRelations,5);
});
test('small paper gets complete source offsets, terms and core in one model call',async()=>{
  const win=fixtureModel();const graph=await buildCompactGraph(win,config,paper,signal);
  assert.equal(win.calls.length,1);assert.equal(graph.stats.calls,1);assert.ok(graphUsable({...paper,graph}));
  assert.equal(graph.paragraphs.map(p=>paper.rawText.slice(p.start,p.end)).join(''),paper.rawText);
  assert.equal(graph.terms[0].name,'adjustment');assert.ok(graph.edges.some(e=>e.type==='回应'));
  const request=compactConversation({...paper,graph},{selection:'',messages:[]},'全文核心与局限是什么');
  const data=JSON.parse(request.messages[1].content.split('\n').slice(1).join('\n'));
  assert.equal(data.knowledgeGraph.chapters.length,2);assert.ok(data.originalEvidence.includes('result = 42'));assert.equal(win.calls.length,1,'routing is local');
  const followup=compactConversation({...paper,graph},{selection:'Adjustment requires exchangeability; result = 42.',paragraphId:'p4',messages:[]},'与开头问题有什么关系');
  assert.match(followup.messages[1].content,/The question is causal inference/);assert.match(followup.evidenceLabel,/p4/);
});
test('incomplete batch retries once without committing a partial graph',async()=>{
  const win=fixtureModel(true);const graph=await buildCompactGraph(win,config,paper,signal);assert.equal(win.calls.length,2);assert.ok(graphUsable({...paper,graph}));
});
test('long paper uses one source pass plus compact synthesis and bounded input',async()=>{
  const long={...paper,rawText:Array.from({length:140},(_,i)=>`Evidence ${i} ${'source condition '.repeat(30)}\n`).join('')};
  const win=fixtureModel();const graph=await buildCompactGraph(win,config,long,signal);
  const groups=outlineBatches(sourceUnits(long.rawText));assert.equal(win.calls.length,groups.length+1);
  assert.ok(graph.stats.inputCharacters<long.rawText.length*1.25,'source is not resubmitted for paragraph and chapter analyses');
  assert.equal(graph.paragraphs.at(-1).end,long.rawText.length);
  for(const call of win.calls)assert.ok(call.reduce((n,m)=>n+m.content.length,0)<30000);
});
test('legacy DOC piece table reads Chinese text and field results without instructions',()=>{
  const text='中文论文\r结果42\r\x13HYPERLINK secret\x14可见链接\x15\r';
  assert.equal(extractDoc(docFixture(text)),'中文论文\n结果42\n可见链接\n');
  assert.equal(extractDoc(docFixture('Test \x93quote\x94\r',true)),'Test “quote”\n');
  assert.throws(()=>extractDoc(new Uint8Array([1,2,3])));
});
test('raw details missing from the outline and chapter relationships remain retrievable',async()=>{
  const target={...paper,rawText:Array.from({length:18},(_,i)=>`line ${i} ${i===17?'RareMarker 729.4':'context'}\n`).join('')};
  const graph=await buildCompactGraph(fixtureModel(),config,target,signal);target.graph=graph;
  const request=compactConversation(target,{selection:'',messages:[]},'Explain RareMarker 729.4');
  assert.match(request.messages[1].content,/RareMarker 729.4/);assert.match(request.evidenceLabel,/p18/);
  graph.edges.push({from:'c1',to:'c2',type:'限制',inferred:true,reason:'条件限制'});
  const followup=compactConversation(target,{selection:'line 0 context',paragraphId:'p1',messages:[]},'限制如何对应');
  const data=JSON.parse(followup.messages[1].content.split('\n').slice(1).join('\n'));
  assert.ok(data.originalEvidence.includes('2 Methods'));
});
