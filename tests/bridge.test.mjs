import test from 'node:test';
import assert from 'node:assert/strict';
import { native, readingStore } from '../web/bridge.mjs';

test('native bridge correlates parallel requests and reports errors', async () => {
  const requests = []; globalThis.PaperNative = { post: text => requests.push(JSON.parse(text)) };
  const first = native('list'), second = native('getConfig');
  nativeReply({ id: requests[1].requestId, value: { model: 'test' } });
  nativeReply({ id: requests[0].requestId, value: { papers: [] } });
  assert.deepEqual(await first, { papers: [] }); assert.deepEqual(await second, { model: 'test' });
  const broken = native('load'); nativeReply({ id: requests[2].requestId, error: '读取失败' });
  await assert.rejects(broken, /读取失败/);
});
test('stopping a model request signals native cancellation and ignores late results', async () => {
  const requests = []; globalThis.PaperNative = { post: text => requests.push(JSON.parse(text)) };
  const controller = new AbortController(); const promise = native('model', { messages: [] }, controller.signal);
  controller.abort(); await assert.rejects(promise, /已停止/);
  assert.equal(requests[1].op, 'cancel'); assert.equal(requests[1].target, requests[0].requestId);
  assert.doesNotThrow(() => nativeReply({ id: requests[0].requestId, value: 'late' }));
});
test('reading saves take snapshots and remain ordered after a failed write', async () => {
  const requests = []; globalThis.PaperNative = { post: text => requests.push(JSON.parse(text)) };
  const store = readingStore(), paper = { id: 'a', title: 'first' };
  const one = store.save(paper); paper.title = 'second'; const two = store.save(paper);
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(requests.length,1); assert.equal(requests[0].paper.title,'first');
  nativeReply({ id: requests[0].requestId, error: '写入失败' }); await assert.rejects(one, /写入失败/);
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(requests[1].paper.title,'second'); nativeReply({ id: requests[1].requestId, value: true }); await two;
});
