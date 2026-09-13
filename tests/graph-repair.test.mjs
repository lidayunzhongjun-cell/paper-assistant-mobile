import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../../paper-assistant-next/src/graph-runtime.mjs';
import { graphUsable } from '../../paper-assistant-next/src/graph.mjs';

const rawText = '1 Introduction\nThis study compares an intervention with a control group, and discusses uncertainty and limitations of the evidence.\n';
const paper = { title: 'Fixture', rawText, graph: { previous: true } };
const config = { endpoint: 'https://fixture.invalid/v1', model: 'fixture' };
function runtime(answer) {
  return { AbortController, setTimeout, clearTimeout, fetch: async (_url, args) => {
    const text = await answer(JSON.parse(args.body).messages);
    return { ok: true, json: async () => ({ choices: [{ message: { content: typeof text === 'string' ? text : JSON.stringify(text) }, finish_reason: 'stop' }] }) };
  } };
}
function valid(system) {
  if (system.includes('先识别材料中的论文章节')) return { paragraphs: [{ first: 1, last: 2, chapter: '1 Introduction', subsection: '', continuesPrevious: false }] };
  if (system.includes('逐段评判重要性')) return { nodes: [{ id: 'p1.1', importance: 'high', density: 'medium', reason: 'Describes the study question.', summary: '比较干预与对照，并讨论证据的不确定性。', keyQuotes: [], relations: [], terms: [] }] };
  if (system.includes('识别这些章节之间')) return { relations: [] };
  return '比较干预与对照，依据 p1 讨论证据的不确定性和限制。';
}
test('invalid structure is repaired once and a usable chapter/paragraph tree is returned', async () => {
  let structureCalls = 0; const steps = [], sent = [];
  const win = runtime(messages => {
    const system = messages[0].content; sent.push(system);
    if (system.includes('先识别材料中的论文章节') && ++structureCalls === 1) return { paragraphs: [] };
    return valid(system);
  });
  const graph = await buildGraph(win, config, paper, new AbortController().signal, s => steps.push(s), { validationRetries: 1 });
  assert.ok(graphUsable({ ...paper, graph })); assert.equal(graph.chapters[0].children[0].id,'p1');
  assert.equal(structureCalls,2); assert.ok(sent.some(s=>s.includes('上一次结构校验失败')));
  assert.ok(steps.some(s=>s.includes('修正图谱格式'))); assert.deepEqual(paper.graph,{previous:true});
});
test('invented optional quotes are dropped without retrying or losing the graph', async () => {
  let descriptions = 0;
  const graph = await buildGraph(runtime(messages => {
    const system = messages[0].content, result = valid(system);
    if (system.includes('逐段评判重要性') && ++descriptions === 1) result.nodes[0].keyQuotes = ['invented result'];
    return result;
  }), config, paper, new AbortController().signal, () => {}, { validationRetries: 1 });
  assert.equal(descriptions,1); assert.deepEqual(graph.paragraphs[0].keyQuotes,[]);
});
test('repeated malformed graph output fails explicitly and preserves the old graph', async () => {
  let calls = 0;
  await assert.rejects(buildGraph(runtime(() => { calls++; return 'not JSON'; }),config,paper,new AbortController().signal,()=>{},{validationRetries:1}), /图谱 JSON/);
  assert.equal(calls,2); assert.deepEqual(paper.graph,{previous:true});
});
