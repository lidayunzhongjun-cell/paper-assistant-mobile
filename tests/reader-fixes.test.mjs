import test from 'node:test';
import assert from 'node:assert/strict';
import { columnLayout, indexedItems, paragraphBounds } from '../web/paragraph-selection.mjs';
import { reflowTranslation } from '../web/translation.mjs';
import { richAnswer, richText } from '../web/math-render.mjs';
test('interleaved PDF drawing order becomes separate left and right reading columns',()=>{
  const lines=[];
  for(let i=0;i<5;i++)for(const x of [40,320])lines.push({str:(x===40?'LEFT':'RIGHT')+i,transform:[10,0,0,10,x,700-i*13],height:10,width:230,hasEOL:true});
  const items=indexedItems({items:lines}),layout=columnLayout(items,600);
  assert.ok(layout.cut>270&&layout.cut<320);
  assert.deepEqual(layout.groups.get('right').map(i=>i.index),[1,3,5,7,9]);
  const bounds=paragraphBounds(items,5,{},0);
  assert.equal(bounds.first,1);assert.equal(bounds.last,9);
  assert.ok(!bounds.text.includes('LEFT'));assert.ok(bounds.text.includes('RIGHT4'));
});
test('single-column and raw reflow keep usable paragraph ranges',()=>{
  const items=indexedItems({items:[700,687,674].map((y,i)=>({str:'Line '+i,transform:[10,0,0,10,40,y],height:10,width:520,hasEOL:true}))});
  assert.equal(columnLayout(items).cut,null);
  assert.equal(paragraphBounds(items,1,{},0).last,2);
});
test('translation removes PDF soft wraps but preserves paragraph breaks',()=>{
  assert.equal(reflowTranslation('结果可\n以推广到\n其他地方。\n\n下一段。'),'结果可以推广到其他地方。\n\n下一段。');
  assert.equal(reflowTranslation('The experi-\nment has\nlimitations.'),'The experiment has limitations.');
});
test('math preserves fractions, matrices, scripts and Markdown tables',()=>{
  for(const text of [String.raw`\(P^*(y\mid do(x))=\sum_z P(y\mid x,z)P^*(z)\)`,String.raw`\[\frac{a_1}{b^2}\]`,String.raw`$$\begin{pmatrix}a&b\\c&d\end{pmatrix}$$`]){
    const html=richAnswer(text);assert.match(html,/class="katex/);assert.match(html,/<math/);
  }
  const table=richAnswer('| A | B |\n|---|---|\n| '+String.raw`\(P(x|y)\)`+' | yes |');
  assert.match(table,/<table>/);assert.equal((table.match(/<td>/g)||[]).length,2);
});
test('math rendering keeps code literal and rejects active HTML and unsafe commands',()=>{
  assert.ok(!richAnswer('`$x^2$`').includes('class="katex'));
  assert.ok(!richAnswer('```tex\n$x^2$\n```').includes('class="katex'));
  assert.ok(!richText('<img src=x onerror=alert(1)>').includes('<img'));
  assert.ok(!richText(String.raw`\(\href{javascript:alert(1)}{x}\)`).includes('<a '));
  assert.match(richAnswer('$20 and $30'),/\$20 and \$30/);
  assert.ok(richText(String.raw`\(\unknowncommand{x}\)`).includes('unknowncommand'));
});
