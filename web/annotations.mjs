export const HIGHLIGHT_COLORS = Object.freeze({
  yellow: { label: '柔黄', value: '#f0d979' },
  green: { label: '浅绿', value: '#9fc9a7' },
  blue: { label: '雾蓝', value: '#9fc5df' },
  pink: { label: '淡粉', value: '#ddb0ba' }
});

const clean = value => String(value || '').trim().replace(/\s+/g, ' ');

export function categoriesOf(paper) {
  return [...new Set((Array.isArray(paper?.categories) ? paper.categories : []).map(clean).filter(Boolean))].slice(0, 20);
}

export function categoryNames(papers) {
  return [...new Set((papers || []).flatMap(categoriesOf))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function setCategories(paper, values) {
  paper.categories = [...new Set((values || []).map(clean).filter(Boolean).map(value => value.slice(0, 40)))].slice(0, 20);
  return paper.categories;
}

export function annotationsOf(paper) {
  if (!Array.isArray(paper.annotations)) paper.annotations = [];
  paper.annotations = paper.annotations.filter(item => item && typeof item === 'object' && typeof item.text === 'string').map(item => ({
    ...item,
    color: HIGHLIGHT_COLORS[item.color] ? item.color : 'yellow',
    note: String(item.note || ''),
    pageIndex: Math.max(0, Number(item.pageIndex) || 0),
    rects: Array.isArray(item.rects) ? item.rects.filter(rect => rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) : []
  }));
  return paper.annotations;
}

const clamp = value => Math.max(0, Math.min(1, value));
const median = values => {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

/*
 * PDF text selections are returned as many partly-overlapping client rects.
 * Painting every fragment makes overlap darker and leaves hairline gaps.  Build
 * stable line bands instead: fragments on the same baseline are grouped, close
 * horizontal pieces are joined, and each band is inset slightly from the line
 * box so neighbouring lines stay visually separate.
 */
export function mergeHighlightRects(rects) {
  const valid = (rects || []).map(rect => {
    const x = clamp(Number(rect?.x)), y = clamp(Number(rect?.y));
    return { page: Number(rect?.page), x, y, width: Math.min(1 - x, Math.max(0, Number(rect?.width))), height: Math.min(1 - y, Math.max(0, Number(rect?.height))), band: rect?.band === true };
  }).filter(rect => Number.isFinite(rect.page) && rect.width > .0002 && rect.height > .0002);
  if (valid.length && valid.every(rect => rect.band)) return valid;
  const output = [];
  for (const page of [...new Set(valid.map(rect => rect.page))].sort((a, b) => a - b)) {
    const lines = [];
    for (const rect of valid.filter(item => item.page === page).sort((a, b) => a.y - b.y || a.x - b.x)) {
      const center = rect.y + rect.height / 2;
      let best = null, score = -Infinity;
      for (const line of lines) {
        const overlap = Math.min(rect.y + rect.height, line.bottom) - Math.max(rect.y, line.top);
        const ratio = overlap / Math.min(rect.height, line.height);
        const distance = Math.abs(center - line.center) / Math.max(rect.height, line.height);
        const candidate = ratio >= .42 || distance <= .34;
        if (candidate && ratio - distance > score) { best = line; score = ratio - distance; }
      }
      if (!best) {
        best = { rects: [], top: rect.y, bottom: rect.y + rect.height, center, height: rect.height };
        lines.push(best);
      }
      best.rects.push(rect);
      const tops = best.rects.map(item => item.y), bottoms = best.rects.map(item => item.y + item.height);
      best.top = median(tops); best.bottom = median(bottoms); best.height = Math.max(.0002, best.bottom - best.top); best.center = (best.top + best.bottom) / 2;
    }
    for (const line of lines.sort((a, b) => a.center - b.center)) {
      const segments = [];
      for (const rect of line.rects.sort((a, b) => a.x - b.x)) {
        const right = rect.x + rect.width, segment = segments.at(-1);
        if (segment && rect.x - segment.right <= .012) segment.right = Math.max(segment.right, right);
        else segments.push({ left: rect.x, right });
      }
      const verticalInset = Math.min(.0025, line.height * .09);
      for (const segment of segments) {
        const horizontalPad = Math.min(.002, Math.max(0, (segment.right - segment.left) * .012));
        const left = clamp(segment.left - horizontalPad), right = clamp(segment.right + horizontalPad);
        output.push({ page, x: left, y: clamp(line.top + verticalInset), width: Math.max(0, right - left), height: Math.max(.0002, line.height - verticalInset * 2), band: true });
      }
    }
  }
  return output;
}

export function captureSelectionRects(selection, host) {
  if (!selection?.rangeCount || selection.isCollapsed || !host?.contains(selection.anchorNode) || !host.contains(selection.focusNode)) return [];
  const range = selection.getRangeAt(0), shells = [...host.querySelectorAll('.page-shell[data-page]')];
  const output = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const shell = shells.find(node => { const box = node.getBoundingClientRect(); return cx >= box.left - 1 && cx <= box.right + 1 && cy >= box.top - 1 && cy <= box.bottom + 1; });
    if (!shell) continue;
    const box = shell.getBoundingClientRect();
    const x = Math.max(0, (rect.left - box.left) / box.width), y = Math.max(0, (rect.top - box.top) / box.height);
    output.push({ page: Number(shell.dataset.page), x, y, width: Math.min(1 - x, rect.width / box.width), height: Math.min(1 - y, rect.height / box.height) });
  }
  return mergeHighlightRects(output);
}

export function captureSelectionLocator(selection, host) {
  if (!selection?.rangeCount || selection.isCollapsed || !host?.contains(selection.anchorNode) || !host.contains(selection.focusNode)) return null;
  const range = selection.getRangeAt(0), start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement, end = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  const shell = start?.closest('.page-shell[data-page]'), endShell = end?.closest('.page-shell[data-page]'); if (!shell || shell !== endShell) return null;
  const root = start.closest('.textLayer,.word-page,.reflow'); if (!root || root !== end.closest('.textLayer,.word-page,.reflow')) return null;
  try {
    const before = document.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
    return { page: Number(shell.dataset.page), start: before.toString().length, end: before.toString().length + range.toString().length };
  } catch { return null; }
}

export function createAnnotation({ text, page, color = 'yellow', note = '', rects = [], locator = null, now = Date.now(), id }) {
  const source = String(text || '').trim();
  if (!source) throw new Error('请先选择原文');
  return { id: id || `a-${now}-${Math.random().toString(36).slice(2, 8)}`, text: source.slice(0, 18000), pageIndex: Math.max(0, Number(page || 1) - 1), color: HIGHLIGHT_COLORS[color] ? color : 'yellow', note: String(note || '').trim().slice(0, 12000), rects, locator, created: now, updated: now };
}

function locatedRects(shell, locator) {
  const root = shell.querySelector('.textLayer,.word-page,.reflow'); if (!root || !locator || locator.page !== Number(shell.dataset.page)) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; let total = 0, node;
  while ((node = walker.nextNode())) { nodes.push({ node, start: total, end: total + node.length }); total += node.length; }
  const start = nodes.find(item => locator.start >= item.start && locator.start <= item.end), end = nodes.find(item => locator.end >= item.start && locator.end <= item.end) || nodes.at(-1); if (!start || !end) return [];
  try {
    const range = document.createRange(); range.setStart(start.node, Math.max(0, Math.min(start.node.length, locator.start - start.start))); range.setEnd(end.node, Math.max(0, Math.min(end.node.length, locator.end - end.start)));
    const box = shell.getBoundingClientRect(); return mergeHighlightRects([...range.getClientRects()].filter(rect => rect.width >= 1 && rect.height >= 1).map(rect => ({ page: locator.page, x: Math.max(0, (rect.left - box.left) / box.width), y: Math.max(0, (rect.top - box.top) / box.height), width: Math.min(1, rect.width / box.width), height: Math.min(1, rect.height / box.height) })));
  } catch { return []; }
}

export function renderAnnotationOverlays(host, annotations) {
  host?.querySelectorAll('.saved-highlight-layer').forEach(node => node.remove());
  if (!host) return;
  for (const shell of host.querySelectorAll('.page-shell[data-page]')) {
    if (!shell.querySelector('.pdf-page,.word-page,.reflow')) continue;
    const page = Number(shell.dataset.page), matches = (annotations || []).map(item => { const located=locatedRects(shell,item.locator); return { item, rects: mergeHighlightRects(located.length ? located : (item.rects || []).filter(rect => rect.page === page)) }; }).filter(entry => entry.rects.length);
    if (!matches.length) continue;
    const layer = document.createElement('div'); layer.className = 'saved-highlight-layer'; layer.setAttribute('aria-hidden', 'true');
    for (const { item, rects } of matches) {
      const group = document.createElement('div'); group.className = 'saved-highlight-group'; group.dataset.annotation = item.id; group.dataset.color = item.color;
      for (const rect of rects) {
        const mark = document.createElement('i');
        Object.assign(mark.style, { left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.width * 100 + '%', height: rect.height * 100 + '%' });
        group.append(mark);
      }
      layer.append(group);
    }
    shell.append(layer);
  }
}

export function excerpt(text, limit = 90) {
  const value = clean(text); return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}
