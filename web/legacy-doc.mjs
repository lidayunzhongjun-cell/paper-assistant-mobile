import CFB from 'cfb';

// MS-DOC 2.4.1: follow the FIB/CLX piece table, never scrape unrelated OLE streams.
export function extractDoc(bytes) {
  const ole=CFB.read(new Uint8Array(bytes),{type:'array'});
  const stream=name=>{const entry=CFB.find(ole,name);if(!entry?.content)throw new Error('DOC 缺少 '+name+' 数据流，可能加密或格式不受支持');return Uint8Array.from(entry.content);};
  const word=stream('WordDocument'), w=new DataView(word.buffer,word.byteOffset,word.byteLength);
  if(w.getUint16(0,true)!==0xa5ec||w.getUint16(2,true)<0xc1)throw new Error('仅支持 Word 97 及以后的 DOC；旧文件请另存为 DOCX');
  const flags=w.getUint16(10,true);if(flags&0x8100)throw new Error('DOC 已加密，请先解除密码');
  const table=stream(flags&0x200?'1Table':'0Table'),t=new DataView(table.buffer,table.byteOffset,table.byteLength);
  const lw=34+w.getUint16(32,true)*2+2, count=w.getUint16(lw-2,true), pairs=lw+count*4+2;
  if(count<11||w.getUint16(pairs-2,true)<34)throw new Error('DOC 文件头不完整');
  let at=w.getUint32(pairs+33*8,true);const length=w.getUint32(pairs+33*8+4,true),end=at+length;
  if(!length||end>table.length)throw new Error('DOC 文本索引越界');
  while(at<end&&table[at]===1)at+=3+t.getUint16(at+1,true);
  if(at+5>end||table[at]!==2)throw new Error('DOC 缺少文本片段表');
  const size=t.getUint32(at+1,true),start=at+5,n=(size-4)/12;
  if(n<1||!Number.isInteger(n)||start+size>end)throw new Error('DOC 文本片段表损坏');
  const total=t.getUint32(start+n*4,true);if(total>1500000)throw new Error('Word 文字超过 150 万字符');
  let text='',cp=0;
  const special={130:0x201a,131:0x192,132:0x201e,133:0x2026,134:0x2020,135:0x2021,136:0x2c6,137:0x2030,138:0x160,139:0x2039,140:0x152,145:0x2018,146:0x2019,147:0x201c,148:0x201d,149:0x2022,150:0x2013,151:0x2014,152:0x2dc,153:0x2122,154:0x161,155:0x203a,156:0x153,159:0x178};
  for(let i=0;i<n;i++){
    const first=t.getUint32(start+i*4,true),last=t.getUint32(start+(i+1)*4,true),fc=t.getUint32(start+(n+1)*4+i*8+2,true);
    if(first!==cp||last<first||last>total)throw new Error('DOC 文本范围不连续');cp=last;
    const compressed=Boolean(fc&0x40000000),offset=(fc&0x3fffffff)/(compressed?2:1),length=(last-first)*(compressed?1:2);
    if(!Number.isInteger(offset)||offset+length>word.length)throw new Error('DOC 文本范围越界');
    if(compressed){for(const b of word.subarray(offset,offset+length))text+=String.fromCharCode(special[b]||b);}
    else text+=new TextDecoder('utf-16le').decode(word.subarray(offset,offset+length));
  }
  const sizes=Array.from({length:8},(_,i)=>w.getUint32(lw+(i+3)*4,true));
  const parts=[];let pos=0;
  const labels=['正文','脚注','页眉页脚','宏','批注','尾注','文本框','页眉文本框'];
  sizes.forEach((size,i)=>{if(pos+size>text.length)throw new Error('DOC 正文不完整');if(size&&[0,1,5,6].includes(i))parts.push((i?'\n【'+labels[i]+'】\n':'')+text.slice(pos,pos+size));pos+=size;});
  // Keep displayed field results, remove field instructions (e.g. hyperlink commands).
  let result='',field=[];
  for(const ch of parts.join('\n')){if(ch==='\x13'){field.push(false);continue;}if(ch==='\x14'){if(field.length)field[field.length-1]=true;continue;}if(ch==='\x15'){field.pop();continue;}if(field.some(v=>!v))continue;result+=ch;}
  return result.replace(/\r/g,'\n').replace(/\x07/g,'\t').replace(/[\x00-\x08\x0b\x0e-\x1f]/g,'').replace(/\x0c/g,'\n\n');
}
