import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'test-results');await mkdir(out,{recursive:true});
await build({stdin:{contents:`import {PdfReader} from './web/pdf-reader.mjs';import {expandParagraph} from './web/paragraph-selection.mjs';import {richAnswer,richText} from './web/math-render.mjs';import './web/app.css';window.reader=new PdfReader(document.querySelector('#pdf-host'),()=>{});Object.assign(window,{expandParagraph,richAnswer,richText});`,resolveDir:root},bundle:true,loader:{'.svg':'dataurl','.png':'dataurl','.gif':'dataurl'},format:'esm',outfile:path.join(out,'reader-regression.js')});
const commands=[];for(let i=0;i<8;i++)for(const [x,label] of [[40,'LEFT'],[320,'RIGHT']])commands.push(`1 0 0 1 ${x} ${730-i*14} Tm (${label} line ${i} with enough printed words here) Tj`);
const content='BT /F1 10 Tf '+commands.join(' ')+' ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
await writeFile(path.join(out,'double-column.pdf'),pdf);
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
 await context.route('https://appassets.androidplatform.net/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/test.html'))return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="reader-regression.css"><link rel="stylesheet" href="katex/katex.min.css"><div id="pdf-host" style="height:550px"></div><div id="math" style="padding:18px"></div><script type="module" src="reader-regression.js"></script>'});
  if(p.endsWith('.pdf'))return route.fulfill({contentType:'application/pdf',body:pdf});
  const file=p.includes('reader-regression.')?path.join(out,path.basename(p)):path.join(root,'android/assets',p.split('/assets/')[1]||'missing');
  return route.fulfill({body:await readFile(file),contentType:/\.m?js$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':'application/octet-stream'});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://appassets.androidplatform.net/assets/test.html');await page.waitForFunction(()=>window.reader);await page.evaluate(()=>reader.open('test'));

 for(const zoom of [1,1.7,3]){
  const geometry=await page.evaluate(async zoom=>{await reader.setZoom(zoom);const rendered=reader.rendered.get(1),scale=(reader.width-16)/600*reader.zoom;return rendered.items.filter(i=>i.str.trim()).map(i=>{const span=rendered.layer.textDivs[i.index],rect=span.getBoundingClientRect();return {width:rect.width,expected:i.width*scale,transform:getComputedStyle(span).transform,font:getComputedStyle(span).font,fontHeight:span.style.getPropertyValue('--font-height'),text:span.textContent,str:i.str};});},zoom);
  assert.ok(geometry.every(g=>g.transform!=='none'&&Math.abs(g.width-g.expected)<Math.max(2,g.expected*.025)), 'text selection geometry must track actual PDF glyph widths at every zoom');
 }
 await page.evaluate(()=>reader.setZoom(1));
 const selection=await page.evaluate(()=>{
  const spans=[...document.querySelectorAll('[data-column="right"] span')].filter(s=>s.textContent.trim());const range=document.createRange();range.setStart(spans[1].firstChild,2);range.setEnd(spans[4].firstChild,12);getSelection().removeAllRanges();getSelection().addRange(range);const manual=getSelection().toString();const expanded=expandParagraph(reader,{});return {manual,expanded};
 });
 assert.ok(selection.manual.includes('RIGHT'));assert.ok(!selection.manual.includes('LEFT'));assert.ok(!selection.expanded.text.includes('LEFT'));assert.ok(!selection.expanded.fingerprint.includes('LEFT'));
 await page.screenshot({path:path.join(out,'07-right-column.png')});
 // Hold repaint, proving the old final gesture image remains while new canvas is unavailable.
 const held=await page.evaluate(async()=>{
  getSelection().removeAllRanges();const old=reader.paint.bind(reader);let release;const gate=new Promise(r=>release=r);reader.paint=async(...args)=>{await gate;return old(...args)};
  window.resumePaint=release;window.repaint=reader.setZoom(1.7);await new Promise(r=>requestAnimationFrame(r));const canvas=document.querySelector('.reader-frame-cover canvas');return {cover:!!canvas,pixels:canvas?Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data).some(x=>x>0):false};
 });
 assert.ok(held.cover&&held.pixels);await page.evaluate(async()=>{resumePaint();await repaint;});assert.equal(await page.locator('.reader-frame-cover').count(),0);
 await page.setViewportSize({width:1180,height:640});
 const tablet=await page.evaluate(async()=>{
  await reader.setMode('scroll');await reader.setZoom(.65);const host=document.querySelector('#pdf-host');host.scrollTop=0;
  const oneFinger={touches:[{clientX:25,clientY:430}],target:document.querySelector('.textLayer span'),preventDefault(){this.prevented=true},prevented:false};reader.touchStart(oneFinger);
  return {prevented:oneFinger.prevented,zones:[...document.querySelectorAll('.reader-gutter')].map(z=>({display:z.style.display,width:z.getBoundingClientRect().width,touch:getComputedStyle(z).touchAction}))};
 });
 assert.equal(tablet.prevented,false,'one finger must remain native for long-press selection and kinetic scroll');
 assert.equal(tablet.zones.length,2);assert.ok(tablet.zones.every(z=>z.display==='block'&&z.width>100&&z.touch.includes('pan')),'landscape gutters must be explicit native pan surfaces');
 const gutter=await page.locator('.reader-gutter-left').boundingBox();await page.mouse.move(gutter.x+gutter.width/2,gutter.y+Math.min(250,gutter.height/2));await page.mouse.wheel(0,260);
 await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.querySelector('#pdf-host').scrollTop>100),'native gutter scrolling must reach the PDF scroll container');
 await page.evaluate(()=>{document.querySelector('#math').className='message assistant';document.querySelector('#math').innerHTML='<div class="body">'+richAnswer(String.raw`### 因果效应
\[P^*(y\mid do(x))=\sum_z P(y\mid do(x),z)P^*(z)\]
**适用条件需要核对原文**。行内分式 \(\frac{a_1}{b^2}\) 与条件概率 \(P(y\mid x)\)。`)+'</div><details class="graph-branch graph-important"><summary><span class="key-label">重点</span> p1 · 结果依赖研究假设</summary></details>';});
 await page.evaluate(()=>document.fonts.ready);assert.ok(await page.locator('#math .katex').count()>=3);
 assert.ok(await page.evaluate(()=>document.fonts.check('16px KaTeX_Main')));await page.screenshot({path:path.join(out,'08-offline-formulas.png')});assert.deepEqual(errors,[]);
 console.log('Right-column selection, native landscape gutter scroll, repaint cover and offline formula fonts passed.');
}finally{await browser.close();}
