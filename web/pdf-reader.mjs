import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { renderPixels } from './pdf-scale.mjs';
import { loadWord, extractWord } from './word-reader.mjs';
import { pinchFrame } from './gesture.mjs';
import { arrangeTextLayer, indexedItems } from './paragraph-selection.mjs';
GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

export function pageText(content) {
  return content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').replace(/\u0000/g, '');
}
export function loadPdf(id) {
  return getDocument({ url: `https://appassets.androidplatform.net/papers/${id}/document.pdf`,
    cMapUrl: './cmaps/', cMapPacked: true, standardFontDataUrl: './standard_fonts/', wasmUrl: './wasm/',
    isEvalSupported: false, disableRange: true, disableStream: true });
}
export async function extractText(pdf, signal, progress = () => {}) {
  let text = ''; const ranges = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    if (signal?.aborted) throw new Error('已停止');
    progress(`读取原文 ${n}/${pdf.numPages} 页…`);
    const page = await pdf.getPage(n); const part = pageText(await page.getTextContent()) + '\n';
    ranges.push({ pageIndex: n - 1, start: text.length, end: text.length + part.length }); text += part;
    if (text.length > 1500000) throw new Error('论文文字超过 150 万字符，请拆分后导入');
  }
  if (text.trim().length < 100) throw new Error('没有足够的可提取文字，扫描版请先 OCR。PDF 仍可阅读。');
  return { text, ranges };
}
export class PdfReader {
  constructor(host,onPosition,onError=()=>{}) {
    Object.assign(this,{host,onPosition,onError,page:1,zoom:1,textMode:false,mode:'paged',generation:0,rendered:new Map(),sizes:new Map(),tasks:new Set()});
    this.host.addEventListener('scroll',()=>{this.scheduleGutters();if(this.mode==='scroll'&&!this.pinching){clearTimeout(this.scrollTimer);this.scrollTimer=setTimeout(()=>this.updateVisible().catch(this.onError),70);}},{passive:true});
    host.addEventListener('touchstart',e=>this.touchStart(e),{passive:false});
    host.addEventListener('touchmove',e=>this.touchMove(e),{passive:false});
    host.addEventListener('touchend',e=>this.touchEnd(e),{passive:false});
    host.addEventListener('touchcancel',e=>this.touchEnd(e),{passive:false});
  }
  async open(id,page=1,options={}) {
    await this.close();this.format=options.format||'pdf';this.mode=options.mode==='scroll'?'scroll':'paged';this.zoom=Math.min(4,Math.max(.5,options.zoom||1));this.textMode=false;
    if(this.format==='pdf'){this.loading=loadPdf(id);this.pdf=await this.loading.promise;const first=await this.pdf.getPage(1);this.base=first.getViewport({scale:1});}
    else {this.word=await loadWord(id,this.format);this.pdf={numPages:this.word.numPages};this.base={width:600,height:800};}
    this.page=Math.max(1,Math.min(page,this.pdf.numPages));await this.render();
  }
  cancelRenders(){for(const task of this.tasks)task.cancel();this.tasks.clear();for(const item of this.rendered.values())item.layer?.cancel();this.rendered.clear();}
  async close(){this.generation++;clearTimeout(this.scrollTimer);cancelAnimationFrame(this.gutterFrame);if(this.pinching)this.host.style.overflow=this.pinching.overflow;this.pinching=null;this.cancelRenders();if(this.loading)await this.loading.destroy();this.pdf=null;this.word=null;this.loading=null;this.stack=null;this.gutters=null;this.width=0;this.sizes.clear();this.host.replaceChildren();}
  get reflow(){return this.word||this.textMode;}
  setPosition(page){if(page!==this.page){this.page=page;this.onPosition(page,this.pdf.numPages,this.zoom,this.mode);} }
  pageForSelection(selection){const node=selection?.anchorNode;return Number((node?.nodeType===1?node:node?.parentElement)?.closest('[data-page]')?.dataset.page)||this.page;}
  anchor(x=this.host.clientWidth/2,y=Math.min(100,this.host.clientHeight/3)) {
    const top=this.host.scrollTop+y, shells=[...(this.stack?.children||[])];
    const shell=shells.find(s=>s.offsetTop+s.offsetHeight>top)||shells.at(-1);
    return shell?{page:Number(shell.dataset.page),x:(this.host.scrollLeft+x-shell.offsetLeft)/shell.offsetWidth,y:(top-shell.offsetTop)/shell.offsetHeight,clientX:x,clientY:y}:null;
  }
  restore(anchor){if(!anchor)return;const shell=this.stack?.querySelector(`[data-page="${anchor.page}"]`);if(shell){this.host.scrollLeft=shell.offsetLeft+shell.offsetWidth*anchor.x-anchor.clientX;this.host.scrollTop=shell.offsetTop+shell.offsetHeight*anchor.y-anchor.clientY;}}
  scheduleGutters(){cancelAnimationFrame(this.gutterFrame);this.gutterFrame=requestAnimationFrame(()=>this.syncGutters());}
  syncGutters(){
    if(!this.stack||!this.pdf)return;
    if(!this.gutters){this.gutters=['left','right'].map(side=>{const zone=document.createElement('div');zone.className=`reader-gutter reader-gutter-${side}`;zone.setAttribute('aria-hidden','true');this.host.append(zone);return zone;});}
    const shell=this.stack.querySelector(`[data-page="${this.page}"]`)||this.stack.firstElementChild;if(!shell)return;
    const host=this.host.getBoundingClientRect(),page=shell.getBoundingClientRect(),left=Math.max(0,Math.min(host.width,page.left-host.left)),right=Math.max(0,Math.min(host.width,host.right-page.right));
    const place=(zone,x,width)=>Object.assign(zone.style,{display:width>6?'block':'none',left:(this.host.scrollLeft+x)+'px',top:this.host.scrollTop+'px',width:width+'px',height:this.host.clientHeight+'px'});
    place(this.gutters[0],0,left);place(this.gutters[1],Math.max(0,page.right-host.left),right);
  }
  async setZoom(value,anchor=this.anchor()){this.zoom=Math.min(4,Math.max(.5,Number(value)||1));await this.render(anchor);}
  async setMode(mode){if(this.mode===mode)return;this.mode=mode==='scroll'?'scroll':'paged';await this.render(null);}
  async show(page){if(!this.pdf)return;this.page=Math.max(1,Math.min(Math.trunc(page)||1,this.pdf.numPages));if(this.mode==='paged')await this.render(null);else{const shell=this.stack.querySelector(`[data-page="${this.page}"]`);this.host.scrollTop=shell.offsetTop;await this.updateVisible();this.onPosition(this.page,this.pdf.numPages,this.zoom,this.mode);}}
  async refresh(){if(this.pdf&&this.host.clientWidth!==this.width)await this.render();}
  freezeFrame(){
    if(!this.host.clientWidth)return null;
    const rect=this.host.getBoundingClientRect(),cover=document.createElement('div');
    Object.assign(cover.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',overflow:'hidden',pointerEvents:'none',zIndex:'35',background:getComputedStyle(this.host).backgroundColor});
    cover.className='reader-frame-cover';
    if(!this.stack){cover.classList.add('reader-loading-cover');cover.textContent='正在准备清晰页面…';}
    else if(!this.reflow){const canvas=document.createElement('canvas'),ratio=Math.min(2,devicePixelRatio||1);canvas.width=Math.ceil(rect.width*ratio);canvas.height=Math.ceil(rect.height*ratio);canvas.style.width=rect.width+'px';canvas.style.height=rect.height+'px';const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
      for(const source of this.stack.querySelectorAll('canvas')){const r=source.getBoundingClientRect();if(r.bottom>rect.top&&r.top<rect.bottom&&r.right>rect.left&&r.left<rect.right)ctx.drawImage(source,r.left-rect.left,r.top-rect.top,r.width,r.height);}cover.append(canvas);
    }else{const clone=this.stack.cloneNode(true);Object.assign(clone.style,{position:'absolute',left:-this.host.scrollLeft+'px',top:(8-this.host.scrollTop)+'px',width:this.stack.offsetWidth+'px',height:this.stack.offsetHeight+'px'});cover.append(clone);}
    document.body.append(cover);return cover;
  }
  async render(anchor=this.anchor()) {
    if(!this.pdf||this.host.clientWidth<1||this.rendering)return;const cover=this.freezeFrame();this.rendering=true;try{const generation=++this.generation;this.cancelRenders();
    this.width=this.host.clientWidth;this.host.replaceChildren();this.gutters=null;this.host.classList.toggle('continuous',this.mode==='scroll');
    this.stack=document.createElement('div');this.stack.className='pdf-stack';this.host.append(this.stack);
    const first=this.mode==='scroll'?1:this.page,last=this.mode==='scroll'?this.pdf.numPages:this.page;
    for(let n=first;n<=last;n++){
      const shell=document.createElement('div');shell.className='page-shell';shell.dataset.page=n;
      const size=this.sizes.get(n)||this.base,fit=Math.max(.1,(this.width-16)/size.width),scale=fit*this.zoom;
      shell.style.width=(this.reflow?this.width-16:size.width*scale)+'px';
      shell.style.minHeight=(this.reflow?Math.max(240,600*this.zoom):size.height*scale)+'px';
      shell.innerHTML=`<div class="page-placeholder">${this.word?'阅读页':'第'} ${n} ${this.word?'':'页'}</div>`;this.stack.append(shell);
    }
    const target=anchor?.page||this.page;
    await this.paint(target,generation);
    if(generation!==this.generation)return;
    if(this.mode==='scroll'){this.page=target;for(const n of [target-1,target+1])if(n>=1&&n<=this.pdf.numPages)await this.paint(n,generation);if(!anchor)this.host.scrollTop=this.stack.querySelector(`[data-page="${target}"]`).offsetTop;}
    if(anchor)this.restore(anchor);else{this.host.scrollLeft=0;if(this.mode==='paged')this.host.scrollTop=0;}
    this.onPosition(this.page,this.pdf.numPages,this.zoom,this.mode);
    this.syncGutters();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }finally{cover?.remove();this.rendering=false;}
  }
  async paint(n,generation=this.generation) {
    if(this.rendered.has(n)||generation!==this.generation)return;
    const shell=this.stack.querySelector(`[data-page="${n}"]`);if(!shell)return;
    const item={pending:true};this.rendered.set(n,item);
    try {
      if(this.reflow){const pre=document.createElement('div');pre.className=this.word?'word-page':'reflow';pre.style.fontSize=(17*this.zoom)+'px';
        if(this.word)pre.innerHTML=this.word.pages[n-1].html;
        else {const page=await this.pdf.getPage(n);const content=await page.getTextContent();item.items=indexedItems(content);pre.textContent=pageText(content)||'本页没有可提取文字，请切回 PDF 查看。';}
        if(generation!==this.generation)return;shell.replaceChildren(pre);shell.style.minHeight='0';
      } else {
        const page=await this.pdf.getPage(n);if(generation!==this.generation)return;
        const base=page.getViewport({scale:1});this.sizes.set(n,base);
        const scale=Math.max(.1,(this.width-16)/base.width)*this.zoom,viewport=page.getViewport({scale}),pixels=renderPixels(viewport.width,viewport.height,devicePixelRatio||1);
        shell.style.width=viewport.width+'px';shell.style.minHeight=viewport.height+'px';
        const wrapper=document.createElement('div');wrapper.className='pdf-page';wrapper.style.width=viewport.width+'px';wrapper.style.height=viewport.height+'px';
        wrapper.style.setProperty('--scale-factor',scale);wrapper.style.setProperty('--total-scale-factor',scale);wrapper.style.setProperty('--user-unit','1');
        const canvas=document.createElement('canvas');canvas.width=pixels.width;canvas.height=pixels.height;canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
        const layer=document.createElement('div');layer.className='textLayer';wrapper.append(canvas,layer);shell.replaceChildren(wrapper);
        item.task=page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,transform:pixels.transform});this.tasks.add(item.task);await item.task.promise;this.tasks.delete(item.task);
        if(generation!==this.generation)return;const content=await page.getTextContent();item.items=indexedItems(content);item.layer=new TextLayer({textContentSource:content,container:layer,viewport});await item.layer.render();item.layer.textDivs.forEach((span,index)=>span.dataset.textIndex=index);arrangeTextLayer(layer,item.layer,item.items,base.width);
      }
      item.pending=false;
    } catch(e){this.rendered.delete(n);if(!['RenderingCancelledException','AbortException'].includes(e.name))throw e;}
  }
  async updateVisible() {
    if(!this.pdf||this.mode!=='scroll'||!this.stack||this.pinching||this.rendering)return;
    const y=this.host.scrollTop+Math.min(this.host.clientHeight/3,160),shells=[...this.stack.children];
    const current=shells.find(s=>s.offsetTop+s.offsetHeight>y)||shells.at(-1);if(!current)return;
    const selection=getSelection(),selected=selection&&!selection.isCollapsed&&this.host.contains(selection.anchorNode),visiblePage=Number(current.dataset.page);
    if(!selected)this.setPosition(visiblePage);const generation=this.generation;
    const wanted=new Set([visiblePage-1,visiblePage,visiblePage+1].filter(n=>n>=1&&n<=this.pdf.numPages));
    for(const [n,item] of this.rendered){if(!wanted.has(n)&&!item.pending){const s=this.stack.querySelector(`[data-page="${n}"]`);if(selected&&selection.rangeCount&&selection.getRangeAt(0).intersectsNode(s))continue;s.style.minHeight=s.offsetHeight+'px';item.layer?.cancel();s.innerHTML=`<div class="page-placeholder">第 ${n} 页</div>`;this.rendered.delete(n);}}
    for(const n of wanted)await this.paint(n,generation);
  }
  touchStart(e){if(e.touches.length!==2||!this.pdf||!this.stack||this.rendering)return;e.preventDefault();
    const [a,b]=e.touches,rect=this.host.getBoundingClientRect(),stack=this.stack.getBoundingClientRect(),x=(a.clientX+b.clientX)/2,y=(a.clientY+b.clientY)/2;
    this.pinching={distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),zoom:this.zoom,x,y,left:stack.left,top:stack.top,anchor:this.anchor(x-rect.left,y-rect.top),target:this.zoom,overflow:this.host.style.overflow};
    clearTimeout(this.scrollTimer);this.host.style.overflow='hidden';this.stack.style.willChange='transform';getSelection()?.removeAllRanges();
  }
  touchMove(e){if(!this.pinching||e.touches.length!==2)return;e.preventDefault();const frame=pinchFrame(this.pinching,...e.touches),rect=this.host.getBoundingClientRect();this.pinching.target=frame.zoom;
    if(this.pinching.anchor){this.pinching.anchor.clientX=frame.x-rect.left;this.pinching.anchor.clientY=frame.y-rect.top;}
    this.stack.style.transformOrigin='0 0';this.stack.style.transform=`translate(${frame.tx}px,${frame.ty}px) scale(${frame.scale})`;
  }
  touchEnd(e){if(!this.pinching||e.touches.length>=2)return;e.preventDefault();const gesture=this.pinching;this.pinching=null;this.host.style.overflow=gesture.overflow;void this.setZoom(gesture.target,gesture.anchor).catch(this.onError);}
  async extract(signal,progress){if(!this.pdf)throw new Error('请先打开文档');return this.word?extractWord(this.word):extractText(this.pdf,signal,progress);}
}
