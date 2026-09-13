import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeSummary } from '../web/summary-import.mjs';
import { docxFixture,docFixture } from './word-fixture.mjs';
test('summary import accepts UTF-8, UTF-16 and both Word formats, preserving original file',async()=>{
 const text='论文总结：研究问题、核心方法、关键结果以及方法成立的条件。'.repeat(3);
 for(const [name,bytes] of [['summary.txt',Buffer.from(text)],['unicode.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')])],['summary.docx',Buffer.from(docxFixture())],['summary.doc',Buffer.from(docFixture())]]){
  const file={name,base64:bytes.toString('base64')},result=await decodeSummary(file);assert.ok(result.text.length>=30);assert.equal(result.base64,file.base64);assert.equal(result.name,name);
 }
});
test('empty, unsupported and oversized summaries do not enter paper cache',async()=>{
 await assert.rejects(decodeSummary({name:'x.txt',base64:btoa('short')}),/文字过少/);
 await assert.rejects(decodeSummary({name:'x.pdf',base64:''}),/Word/);
 await assert.rejects(decodeSummary({name:'x.txt',base64:btoa('a'.repeat(30001))}),/3 万/);
});
