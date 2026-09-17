import { createWorker, OEM, PSM } from 'tesseract.js';
import { looksCorruptText, textQuality } from './text-quality.mjs';

let workerPromise;
const asset = name => new URL(name, location.href).href;

export { looksCorruptText };

export function cleanOcrText(value) {
  return String(value || '').normalize('NFKC')
    .replace(/[ \t]+/g, ' ')
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/(?<=[\u3400-\u9fff，、；：！？）])\n(?=[\u3400-\u9fff（])/g, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function ocrWorker(progress) {
  if (!workerPromise) workerPromise = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
    workerPath: asset('./ocr/worker.min.js'), corePath: asset('./ocr/tesseract-core-lstm.js'),
    langPath: asset('./ocr/lang'), gzip: true, workerBlobURL: false,
    logger: message => progress?.(message.status === 'recognizing text' ? `离线识别选段 ${Math.round((message.progress || 0) * 100)}%…` : '正在准备离线文字识别…')
  }).then(async worker => {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1' });
    return worker;
  }).catch(error => { workerPromise = null; throw error; });
  return workerPromise;
}

export function selectionImage(host, page, rects) {
  const shell = host?.querySelector(`.page-shell[data-page="${page}"]`), source = shell?.querySelector('.pdf-page canvas');
  if (!shell || !source) throw new Error('当前 PDF 页面尚未绘制完成，请回到原文稍后重试');
  const bands = (rects || []).filter(rect => rect.page === page).sort((a, b) => a.y - b.y || a.x - b.x);
  if (!bands.length) throw new Error('没有取得选段图像范围，请重新选择文字');
  const crops = bands.map(rect => {
    const padX = Math.max(8, source.width * .003), padY = Math.max(5, rect.height * source.height * .16);
    const left = Math.max(0, rect.x * source.width - padX), top = Math.max(0, rect.y * source.height - padY);
    const right = Math.min(source.width, (rect.x + rect.width) * source.width + padX), bottom = Math.min(source.height, (rect.y + rect.height) * source.height + padY);
    const height = Math.max(1, bottom - top), scale = Math.min(2.2, Math.max(1, 52 / height));
    return { left, top, width: Math.max(1, right - left), height, scale };
  });
  const gap = 8, width = Math.min(4096, Math.ceil(Math.max(...crops.map(crop => crop.width * crop.scale)) + 20));
  const height = Math.min(8192, Math.ceil(crops.reduce((sum, crop) => sum + crop.height * crop.scale + gap, 12)));
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const context = output.getContext('2d', { alpha: false }); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.imageSmoothingEnabled = true;
  let y = 6;
  for (const crop of crops) {
    const targetWidth = Math.min(width - 20, crop.width * crop.scale), targetHeight = crop.height * crop.scale;
    if (y + targetHeight > height) break;
    context.drawImage(source, crop.left, crop.top, crop.width, crop.height, 10, y, targetWidth, targetHeight); y += targetHeight + gap;
  }
  return output;
}

export async function recoverSelectionText({ host, page, rects, original, signal, progress }) {
  try {
    if (signal?.aborted) throw new Error('已停止');
    const image = selectionImage(host, page, rects), worker = await ocrWorker(progress);
    if (signal?.aborted) throw new Error('已停止');
    const result = await worker.recognize(image); if (signal?.aborted) throw new Error('已停止');
    const text = cleanOcrText(result.data.text), before = textQuality(original), after = textQuality(text);
    if (text.length < 12 || (after.score >= before.score && looksCorruptText(text))) throw new Error('离线识别没有得到可靠文字；请缩小选区、放大 PDF 后重新选择');
    return { text, confidence: Math.round(result.data.confidence || 0) };
  } catch(error) {
    if(error.message==='已停止'||/离线识别没有得到/.test(error.message)||/页面|选段图像/.test(error.message))throw error;
    throw new Error('离线文字识别启动失败，请更新 Android System WebView 后重试');
  }
}
