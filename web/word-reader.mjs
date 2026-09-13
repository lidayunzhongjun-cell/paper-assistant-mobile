import mammoth from 'mammoth';
import { extractDoc } from './legacy-doc.mjs';

export function safeWordHtml(html) {
  const parsed=new DOMParser().parseFromString(html,'text/html'), root=document.createElement('div');
  const allowed=new Set(['P','H1','H2','H3','H4','H5','H6','STRONG','EM','B','I','U','S','SUP','SUB','BR','UL','OL','LI','TABLE','THEAD','TBODY','TR','TD','TH','BLOCKQUOTE','HR','IMG']);
  function copy(node,parent){
    if(node.nodeType===3){parent.append(document.createTextNode(node.textContent));return;}
    if(node.nodeType!==1||['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH'].includes(node.tagName))return;
    if(!allowed.has(node.tagName)){for(const child of node.childNodes)copy(child,parent);return;}
    const el=document.createElement(node.tagName.toLowerCase());
    if(node.tagName==='IMG'){
      const src=node.getAttribute('src')||'';
      if(!/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)||src.length>14000000){parent.append(document.createTextNode('[图片暂无法显示]'));return;}
      el.src=src;el.alt=node.getAttribute('alt')||'文档插图';
    }
    for(const key of ['colspan','rowspan']){const n=Number(node.getAttribute(key));if(n>0&&n<100)el.setAttribute(key,String(n));}
    for(const child of node.childNodes)copy(child,el);parent.append(el);
  }
  for(const child of parsed.body.childNodes)copy(child,root);return root;
}
function textOf(node){
  if(node.nodeType===3)return node.textContent;
  if(node.nodeType!==1)return '';
  if(node.tagName==='IMG')return '[插图：图像内容未纳入文本证据]';
  if(node.tagName==='BR')return '\n';
  return Array.from(node.childNodes).map(textOf).join('')+(/^(P|H[1-6]|TR|LI|BLOCKQUOTE)$/.test(node.tagName)?'\n':['TD','TH'].includes(node.tagName)?'\t':'');
}
export async function loadWord(id,format) {
  const response=await fetch(`https://appassets.androidplatform.net/papers/${id}/document.${format}`);
  if(!response.ok)throw new Error('无法读取 Word 文件');const bytes=await response.arrayBuffer();
  let root;
  if(format==='doc') {root=document.createElement('div');for(const text of extractDoc(bytes).split('\n')){const p=document.createElement('p');p.textContent=text||' ';root.append(p);}}
  else {
    const result=await mammoth.convertToHtml({arrayBuffer:bytes},{includeEmbeddedStyleMap:false,externalFileAccess:false});root=safeWordHtml(result.value);
  }
  const pages=[];let html='',text='';
  for(const node of root.childNodes){const part=textOf(node);if(text.length+part.length>3500&&text){pages.push({html,text:text+'\n'});html='';text='';}html+=node.outerHTML||node.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;');text+=part;}
  if(text||html)pages.push({html,text:text+'\n'});
  if(!pages.length)throw new Error('Word 文件没有可阅读内容');
  if(pages.reduce((n,p)=>n+p.text.length,0)>1500000)throw new Error('Word 文字超过 150 万字符');
  return {pages,numPages:pages.length,format};
}
export function extractWord(doc){let text='';const ranges=doc.pages.map((p,i)=>{const start=text.length;text+=p.text;return {pageIndex:i,start,end:text.length};});return {text,ranges};}
