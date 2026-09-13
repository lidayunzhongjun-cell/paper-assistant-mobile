let serial = 0;
const pending = new Map();
globalThis.nativeReply = message => {
  const task = pending.get(message.id); if (!task) return;
  pending.delete(message.id); task.cleanup();
  if (message.error) task.reject(new Error(message.error)); else task.resolve(message.value);
};
export function native(op, args = {}, signal) {
  return new Promise((resolve, reject) => {
    if (!globalThis.PaperNative?.post) { reject(new Error('请在已安装的 Android App 内打开。')); return; }
    if (signal?.aborted) { reject(new Error('已停止')); return; }
    const requestId = `r${++serial}`;
    const abort = () => {
      pending.delete(requestId); signal?.removeEventListener('abort', abort);
      globalThis.PaperNative.post(JSON.stringify({ op: 'cancel', requestId: `r${++serial}`, target: requestId }));
      reject(new Error('已停止'));
    };
    pending.set(requestId, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    try { globalThis.PaperNative.post(JSON.stringify({ ...args, op, requestId })); }
    catch (e) { pending.delete(requestId); signal?.removeEventListener('abort', abort); reject(e); }
  });
}
export const modelWindow = {
  AbortController,
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: (...args) => globalThis.clearTimeout(...args),
  fetch: async (_url, options) => {
    const data = await native('model', { messages: JSON.parse(options.body).messages }, options.signal);
    return { ok: true, json: async () => data };
  }
};
export function readingStore() {
  let queue = Promise.resolve();
  return {
    save(paper) {
      const snapshot = JSON.parse(JSON.stringify(paper));
      const operation = queue.catch(() => {}).then(() => native('save', { paperId: snapshot.id, paper: snapshot }));
      queue = operation; return operation;
    },
    flush: () => queue
  };
}
