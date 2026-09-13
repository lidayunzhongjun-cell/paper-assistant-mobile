import { native, modelWindow } from './bridge.mjs';
import { loadPdf, extractText } from './pdf-reader.mjs';
import { buildCompactGraph } from './compact-graph.mjs';
import { loadWord, extractWord } from './word-reader.mjs';
import { graphUsable } from '../../paper-assistant-next/src/graph.mjs';

let callIndex = 0;
const controller = new AbortController();
const backgroundWindow = { ...modelWindow, fetch: async (_url, options) => {
  await progressQueue; if(progressError)throw progressError;
  const data = await native('model', { index: callIndex++, messages: JSON.parse(options.body).messages }, options.signal);
  return { ok: true, json: async () => data };
} };
let progressQueue = Promise.resolve(), progressError;
const progress = message => { progressQueue = progressQueue.then(() => native('jobProgress', { message })).catch(e => { progressError = e; controller.abort(); }); };
try {
  const { paper, config } = await native('jobInput');
  if (!paper.rawText) {
    const loading = !paper.format || paper.format === 'pdf' ? loadPdf(paper.id) : null;
    try {
      const extracted = loading ? await extractText(await loading.promise, controller.signal, progress) : extractWord(await loadWord(paper.id,paper.format));
      paper.rawText = extracted.text; paper.pageRanges = extracted.ranges;
      await native('jobExtracted', { paper });
    } finally { await loading?.destroy(); }
  }
  const graph = await buildCompactGraph(backgroundWindow, config, paper, controller.signal, progress);
  if (!graphUsable({ ...paper, graph })) throw new Error('生成结果未形成完整树状图谱，请继续建图重试');
  await progressQueue;
  if (progressError) throw progressError;
  await native('jobComplete', { result: { rawText: paper.rawText, pageRanges: paper.pageRanges, graph, overview: graph.narrative, overviewModel: config.model, overviewTime: Date.now() } });
} catch (e) {
  await native('jobError', { message: e.message || '建图失败，可从已保存批次继续', retryIndex: Math.max(0, callIndex - 1) });
}
