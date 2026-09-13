import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('old Android WebView gets a generic Promise.withResolvers implementation', async () => {
  class OldPromise extends Promise {}
  Object.defineProperty(OldPromise, 'withResolvers', { value: undefined, configurable: true, writable: true });
  const context = { Promise: OldPromise };
  context.globalThis = context;
  assert.equal(context.Promise.withResolvers, undefined);
  vm.runInNewContext(await readFile(new URL('../web/compat.js', import.meta.url), 'utf8'), context);
  const capability = context.Promise.withResolvers();
  assert.ok(capability.promise instanceof OldPromise);
  capability.resolve('opened');
  assert.equal(await capability.promise, 'opened');
});

test('compatibility layer does not replace a native implementation', async () => {
  const native = () => ({ native: true });
  class ModernPromise extends Promise {}
  ModernPromise.withResolvers = native;
  const context = { Promise: ModernPromise };
  context.globalThis = context;
  vm.runInNewContext(await readFile(new URL('../web/compat.js', import.meta.url), 'utf8'), context);
  assert.equal(context.Promise.withResolvers, native);
});

test('old Android ReadableStream becomes async iterable for PDF text layers', async () => {
  class OldReadableStream {
    constructor(values) { this.values = [...values]; }
    getReader() {
      const values = this.values; return {
        read: async () => values.length ? {done:false,value:values.shift()} : {done:true,value:undefined},
        cancel: async () => {}, releaseLock() {}
      };
    }
  }
  const context={Promise,Symbol,ReadableStream:OldReadableStream};context.globalThis=context;
  vm.runInNewContext(await readFile(new URL('../web/compat.js',import.meta.url),'utf8'),context);
  const found=[];for await(const value of new context.ReadableStream(['文字','层']))found.push(value);
  assert.deepEqual(found,['文字','层']);
});
