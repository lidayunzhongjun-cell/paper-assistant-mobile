import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfFontOptions, resolveFontMode } from '../web/pdf-font-mode.mjs';

test('tablet auto mode uses internal glyph paths while phones keep web fonts',()=>{
  assert.equal(resolveFontMode('auto',1280,800),'path');
  assert.equal(resolveFontMode('auto',873,393),'web');
  assert.equal(resolveFontMode('web',1280,800),'web');
  assert.equal(resolveFontMode('path',390,844),'path');
  assert.deepEqual(pdfFontOptions('path'),{disableFontFace:true,useSystemFonts:false});
  assert.deepEqual(pdfFontOptions('web'),{disableFontFace:false,useSystemFonts:true});
});
