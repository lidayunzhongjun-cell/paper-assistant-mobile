import test from 'node:test';
import assert from 'node:assert/strict';
import { annotationsOf, categoriesOf, categoryNames, createAnnotation, setCategories, excerpt, mergeHighlightRects } from '../web/annotations.mjs';

test('paper categories are cleaned, deduplicated and shared for library filters', () => {
  const paper = { categories: [' 因果推断 ', '方法', '因果推断', ''] };
  assert.deepEqual(categoriesOf(paper), ['因果推断', '方法']);
  setCategories(paper, [' 阅读 ', '阅读', 'A'.repeat(60)]);
  assert.deepEqual(paper.categories, ['阅读', 'A'.repeat(40)]);
  assert.deepEqual(categoryNames([{ categories: ['方法'] }, paper]), ['方法', '阅读', 'A'.repeat(40)].sort((a,b)=>a.localeCompare(b,'zh-CN')));
});

test('annotations keep color, note, page and normalized legacy defaults', () => {
  const item = createAnnotation({ text: ' selected evidence ', page: 3, color: 'blue', note: 'condition', rects: [{ page: 3, x: .1, y: .2, width: .3, height: .04 }], now: 12, id: 'a1' });
  assert.equal(item.pageIndex, 2); assert.equal(item.color, 'blue'); assert.equal(item.note, 'condition');
  const paper = { annotations: [item, { id: 'old', text: 'legacy', pageIndex: -2, color: 'unknown' }, null] };
  const normalized = annotationsOf(paper);
  assert.equal(normalized.length, 2); assert.equal(normalized[1].color, 'yellow'); assert.equal(normalized[1].pageIndex, 0);
  assert.equal(excerpt('a '.repeat(100), 20).length, 20);
});

test('highlight fragments become uniform line bands without joining columns', () => {
  const merged = mergeHighlightRects([
    { page: 1, x: .10, y: .20, width: .18, height: .03 },
    { page: 1, x: .275, y: .201, width: .16, height: .029 },
    { page: 1, x: .12, y: .199, width: .08, height: .031 },
    { page: 1, x: .10, y: .25, width: .31, height: .03 },
    { page: 1, x: .62, y: .20, width: .18, height: .03 },
    { page: 2, x: .10, y: .20, width: .20, height: .03 }
  ]);
  assert.equal(merged.length, 4, 'same-line overlap joins, separate column/line/page stays separate');
  const first = merged.find(rect => rect.page === 1 && rect.y < .23 && rect.x < .2);
  assert.ok(first.x < .10 && first.width > .335);
  assert.ok(merged.every(rect => rect.width > 0 && rect.height > 0));
  const again = mergeHighlightRects(merged);
  assert.deepEqual(again, merged, 'normalizing saved rectangles remains stable');
});
