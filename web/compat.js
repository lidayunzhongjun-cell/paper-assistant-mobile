(function (global) {
  // Promise.withResolvers reached Chromium in 2024. Some otherwise supported
  // Android System WebView versions do not provide it yet.
  if (typeof global.Promise.withResolvers !== 'function') {
    Object.defineProperty(global.Promise, 'withResolvers', {
      configurable: true,
      writable: true,
      value: function withResolvers() {
        var resolve, reject;
        var promise = new this(function (onResolve, onReject) {
          resolve = onResolve;
          reject = onReject;
        });
        return { promise: promise, resolve: resolve, reject: reject };
      }
    });
  }
  // Chromium 110 exposes ReadableStream but not its async iterator. PDF.js 6
  // uses `for await` while constructing the selectable text layer.
  if (global.ReadableStream && global.Symbol && global.Symbol.asyncIterator &&
      typeof global.ReadableStream.prototype[global.Symbol.asyncIterator] !== 'function') {
    Object.defineProperty(global.ReadableStream.prototype, global.Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: function asyncIterator() {
        var reader = this.getReader();
        var released = false;
        function release() { if (!released) { released = true; reader.releaseLock(); } }
        var iterator = {
          next: function () {
            return reader.read().then(function (result) { if (result.done) release(); return result; }, function (error) { release(); throw error; });
          },
          return: function (value) {
            return Promise.resolve(reader.cancel(value)).catch(function () {}).then(function () { release(); return { done: true, value: value }; });
          }
        };
        iterator[global.Symbol.asyncIterator] = function () { return this; };
        return iterator;
      }
    });
  }
})(globalThis);
