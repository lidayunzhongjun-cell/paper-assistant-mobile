import mammoth from 'mammoth';
import { extractDoc } from './legacy-doc.mjs';
export async function decodeSummary(file) {
  const format=file.name.split('.').at(-1).toLowerCase();
  if(!['txt','docx','doc'].includes(format))throw new Error('请选择 Word 或 TXT 总结');
  const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
  if(bytes.length>2000000)throw new Error('总结文件请控制在 2 MB 内');
  let text;const headings=[];
  if(format==='docx'){
    text=(await mammoth.extractRawText({arrayBuffer:bytes.buffer,buffer:bytes},{externalFileAccess:false})).value;
    const textOf=node=>node.type==='text'?node.value:(node.children||[]).map(textOf).join('');
    await mammoth.convertToHtml({arrayBuffer:bytes.buffer,buffer:bytes},{externalFileAccess:false,includeEmbeddedStyleMap:false,
      convertImage:mammoth.images.imgElement(async()=>({src:''})),transformDocument:document=>{
        const walk=node=>{if(node.type==='paragraph'){const match=(node.styleName||node.styleId||'').match(/(?:heading|标题)\s*([1-6])/i);if(match)headings.push({text:textOf(node).trim(),level:Number(match[1])});}for(const child of node.children||[])walk(child);};walk(document);return document;
      }});
  }
  else if(format==='doc')text=extractDoc(bytes.buffer);
  else if(bytes[0]===255&&bytes[1]===254)text=new TextDecoder('utf-16le').decode(bytes);
  else if(bytes[0]===254&&bytes[1]===255)text=new TextDecoder('utf-16be').decode(bytes);
  else {try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('gb18030').decode(bytes);}}
  text=text.replace(/\u0000/g,'').trim();
  if(text.length<30)throw new Error('总结文字过少，至少需要 30 个字符');
  if(text.length>120000)throw new Error('导入文档最多 12 万字符；请分成更凝练的总结后重试');
  return {...file,format,text,headings,imported:Date.now()};
}
