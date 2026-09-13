import CFB from 'cfb';
import { zipSync, strToU8 } from 'fflate';
export function docFixture(text='第一章 研究问题\r本研究分析因果关系。\r第二章 方法\r采用对照与调整方法，并说明限制。\r', compressed=false) {
  const content=compressed?Uint8Array.from([...text].map(c=>c.charCodeAt(0))):new Uint8Array(Buffer.from(text,'utf16le'));
  const word=new Uint8Array(512+content.length),w=new DataView(word.buffer);
  w.setUint16(0,0xa5ec,true);w.setUint16(2,0xc1,true);w.setUint16(32,14,true);w.setUint16(62,22,true);w.setUint32(76,text.length,true);w.setUint16(152,34,true);
  w.setUint32(154+33*8,0,true);w.setUint32(154+33*8+4,21,true);word.set(content,512);
  const table=new Uint8Array(21),t=new DataView(table.buffer);table[0]=2;t.setUint32(1,16,true);t.setUint32(9,text.length,true);t.setUint32(15,compressed?0x40000400:512,true);
  const ole=CFB.utils.cfb_new();CFB.utils.cfb_add(ole,'WordDocument',word);CFB.utils.cfb_add(ole,'0Table',table);
  return new Uint8Array(CFB.write(ole,{type:'buffer'}));
}
export function docxFixture() {
  const body='<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 研究问题</w:t></w:r></w:p>'+Array.from({length:65},(_,i)=>`<w:p><w:r><w:t>段落 ${i+1}：本研究分析因果关系，采用对照与调整方法，并说明适用条件和研究限制。引用原文回答，避免将相关性误认为因果性。</w:t></w:r></w:p>`).join('')+'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格证据</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>实验组 42</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  return zipSync(Object.fromEntries(Object.entries({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml':'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>',
    'word/document.xml':`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  }).map(([name,value])=>[name,strToU8(value)])));
}
