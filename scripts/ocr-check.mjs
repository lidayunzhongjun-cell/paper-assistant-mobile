import {chromium} from 'playwright-core';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),assets=path.join(root,'android/assets');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext();
await context.route('https://appassets.androidplatform.net/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/assets/ocr-test.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><canvas id="source" width="1500" height="180"></canvas><script src="ocr/tesseract.min.js"></script>'});
  if(!pathname.startsWith('/assets/')||pathname.includes('..'))return route.abort();
  const file=path.join(assets,pathname.slice(8));
  try{return route.fulfill({body:await readFile(file),contentType:pathname.endsWith('.wasm')?'application/wasm':pathname.endsWith('.js')?'text/javascript':'application/octet-stream'});}catch{return route.abort();}
});
const page=await context.newPage();await page.goto('https://appassets.androidplatform.net/assets/ocr-test.html');
const result=await page.evaluate(async()=>{
  const canvas=document.getElementById('source'),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';ctx.font='52px "Microsoft YaHei",sans-serif';ctx.fillText('基于 SMT 的抽象精化方法用于验证神经网络。',20,105);
  const worker=await Tesseract.createWorker(['chi_sim','eng'],Tesseract.OEM.LSTM_ONLY,{workerPath:'ocr/worker.min.js',corePath:'ocr/tesseract-core-lstm.js',langPath:'ocr/lang',gzip:true,workerBlobURL:false});
  await worker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SINGLE_LINE});const {data}=await worker.recognize(canvas);await worker.terminate();return data.text;
});
const compact=result.replace(/\s+/g,'');assert.match(compact,/抽象精化/);assert.match(compact,/神经网络/);await browser.close();console.log('Offline Chinese/English OCR smoke passed:',result.trim());
