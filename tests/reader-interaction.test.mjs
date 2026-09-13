import test from 'node:test';
import assert from 'node:assert/strict';
import { pinchFrame } from '../web/gesture.mjs';
import { indexedItems,layoutParagraph } from '../web/paragraph-selection.mjs';
import { translationChunks,translationKey } from '../web/translation.mjs';
test('pinch preserves the content under the midpoint while zooming and moving',()=>{
  const start={zoom:1.4,distance:100,x:200,y:300,left:-150,top:-800};
  const frame=pinchFrame(start,{clientX:150,clientY:350},{clientX:350,clientY:350});
  assert.equal(frame.zoom,2.8);
  assert.equal(start.left+frame.tx+(start.x-start.left)*frame.scale,250);
  assert.equal(start.top+frame.ty+(start.y-start.top)*frame.scale,350);
  const pan=pinchFrame(start,{clientX:180,clientY:280},{clientX:280,clientY:280});
  assert.equal(pan.scale,1);assert.equal(pan.tx,30);assert.equal(pan.ty,-20);
});
test('layout paragraph joins wrapped lines but stops at indentation and column boundaries',()=>{
  const line=(str,x,y,width=200)=>({str,transform:[10,0,0,10,x,y],height:10,width,hasEOL:true});
  const items=indexedItems({items:[line('Heading',40,760),line('first paragraph starts',50,730),line('continued line',40,717),line('last line.',40,704,130),line('next paragraph',50,691),line('continued',40,678),line('other column',310,730)]});
  assert.deepEqual(layoutParagraph(items,2),{first:1,last:3});
  assert.deepEqual(layoutParagraph(items,4),{first:4,last:5});
  assert.deepEqual(layoutParagraph(items,6),{first:6,last:6});
});
test('translation chunks preserve Unicode and all source bytes within service limit',()=>{
  const text=('A sentence with symbols 👩‍🔬. 科学研究与条件限制。\n').repeat(120),parts=translationChunks(text);
  assert.equal(parts.join(''),text);assert.ok(parts.every(p=>new TextEncoder().encode(p).length<=480));
  assert.notEqual(translationKey('same',{provider:'ai',source:'en',target:'zh'},'modelA'),translationKey('same',{provider:'ai',source:'en',target:'zh'},'modelB'));
  assert.notEqual(translationKey('same',{provider:'ai',source:'en',target:'zh'},'modelA'),translationKey('same',{provider:'ai',source:'en',target:'ja'},'modelA'));
});
