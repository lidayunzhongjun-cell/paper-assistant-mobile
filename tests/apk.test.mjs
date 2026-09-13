import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { apkZip, inspectResourceTable, verifyResourceTable } from '../scripts/apk-format.mjs';
const table = new TextEncoder().encode('resource-table-fixture'.repeat(100));

test('recompression regression is rejected with Android -124', () => {
  const bad = zipSync({ 'resources.arsc': table }, { level: 6 });
  assert.equal(inspectResourceTable(bad).compressionMethod, 8);
  assert.throws(() => verifyResourceTable(bad), /-124.*uncompressed/);
});
test('resource table is stored while other APK entries can be compressed', () => {
  const apk = apkZip({ 'resources.arsc': table, 'assets/app.js': table });
  assert.equal(verifyResourceTable(apk).compressionMethod, 0);
  assert.equal(verifyResourceTable(apk).aligned4, true);
});
test('stored but misaligned resources are also rejected', () => {
  let apk;
  for (let i = 0; i < 4; i++) {
    apk = apkZip({ ['x'.repeat(i + 1)]: new Uint8Array(1), 'resources.arsc': table });
    if (!inspectResourceTable(apk).aligned4) break;
  }
  assert.throws(() => verifyResourceTable(apk), /-124.*aligned/);
});
test('missing or truncated resource tables cannot pass the installation gate', () => {
  assert.throws(() => apkZip({}), /missing/);
  assert.throws(() => verifyResourceTable(zipSync({ 'other': table })), /missing/);
  assert.throws(() => verifyResourceTable(apkZip({ 'resources.arsc': table }).slice(0, -8)), /truncated/);
});
