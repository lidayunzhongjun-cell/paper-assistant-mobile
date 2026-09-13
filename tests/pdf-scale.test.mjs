import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPixels } from '../web/pdf-scale.mjs';

test('high-density phones retain their native pixel density above 2x', () => {
  const p = renderPixels(380, 520, 3.5);
  assert.equal(p.width, 1330); assert.equal(p.height, 1820);
  assert.deepEqual(p.transform, [3.5, 0, 0, 3.5, 0, 0]);
});
test('zoom rerenders at more pixels while allocation stays bounded', () => {
  const normal = renderPixels(380, 520, 3), zoom = renderPixels(760, 1040, 3);
  assert.equal(zoom.width, normal.width * 2);
  const large = renderPixels(4000, 8000, 4);
  assert.ok(large.width * large.height <= 16_000_000);
  assert.ok(large.width <= 8192 && large.height <= 8192);
  assert.ok(Math.abs(large.transform[0] - large.transform[3]) < .001);
});
test('extreme page dimensions remain inside canvas limits', () => {
  const p = renderPixels(100, 20000, 4);
  assert.ok(p.height <= 8192); assert.ok(p.width >= 1);
  assert.throws(() => renderPixels(0, 500, 3), /尺寸/);
});
