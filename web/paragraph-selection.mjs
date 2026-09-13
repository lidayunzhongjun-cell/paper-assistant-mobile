import { graphUsable } from '../../paper-assistant-next/src/graph.mjs';
export function columnLayout(items,width=600){
  const bands=[];
  for(const item of items.filter(i=>i.str.trim())){const x=item.transform[4],y=item.transform[5],h=Math.max(5,item.height||Math.abs(item.transform[3]));let band=bands.find(b=>Math.abs(b.y-y)<h*.4);if(!band){band={y,parts:[]};bands.push(band);}band.parts.push({x,end:x+item.width,h});}
  const gaps=[];for(const band of bands){const parts=band.parts.sort((a,b)=>a.x-b.x);let end=parts[0]?.end||0;for(let i=1;i<parts.length;i++){const p=parts[i];if(p.x-end>Math.max(12,p.h*1.5)&&end>width*.25&&p.x<width*.75)gaps.push((end+p.x)/2);end=Math.max(end,p.end);}}
  let cut=null,best=0;for(const x of gaps){const count=gaps.filter(y=>Math.abs(x-y)<width*.045).length;if(count>best){best=count;cut=x;}}if(best<3)cut=null;
  const groups=new Map();for(const item of items){const x=item.transform[4],end=x+item.width;const column=cut===null?'single':end<=cut?'left':x>=cut?'right':'wide';item.column=column;if(!groups.has(column))groups.set(column,[]);groups.get(column).push(item);}
  for(const list of groups.values())list.sort((a,b)=>Math.abs(a.transform[5]-b.transform[5])>Math.max(a.height,b.height,5)*.4?b.transform[5]-a.transform[5]:a.transform[4]-b.transform[4]);
  return {cut,groups};
}
export function arrangeTextLayer(container,layer,items,width){
  const {groups}=columnLayout(items,width);
  // DOM order must follow columns, even if PDF drawing commands interleave both columns.
  for(const name of ['wide','single','left','right']){const list=groups.get(name);if(!list)continue;const group=document.createElement('div');group.className='pdf-text-column markedContent';group.dataset.column=name;
    for(const item of list){const span=layer.textDivs[item.index];if(span?.isConnected){const br=span.nextSibling;span.dataset.column=name;group.append(span);if(br?.nodeName==='BR')group.append(br);}}
    container.append(group);
  }
  // Small-font raster metrics differ from CSS layout on some Android WebViews.
  // Calibrate horizontal hit boxes to the PDF's own glyph advance widths.
  const scale=container.getBoundingClientRect().width/width;
  const calibrated=[];
  for(const item of items){const span=layer.textDivs[item.index];if(!span?.isConnected||!item.str.trim()||item.width<=0||parseFloat(span.style.getPropertyValue('--rotate')||'0')!==0)continue;
    const measured=span.getBoundingClientRect().width,target=item.width*scale;
    if(measured>0&&target>0)calibrated.push([span,String((parseFloat(span.style.getPropertyValue('--scale-x'))||1)*target/measured)]);
  }
  for(const [span,value] of calibrated)span.style.setProperty('--scale-x',value);
}
export function indexedItems(content) {
  let offset=0;
  return content.items.filter(x=>'str' in x).map((item,index)=>{const text=item.str+(item.hasEOL?'\n':' '),start=offset;offset+=text.length;return {...item,index,start,end:offset,text};});
}
export function layoutParagraph(items,index) {
  const lines=[];let line;
  for(const item of items){
    const x=item.transform?.[4]||0,y=item.transform?.[5]||0,h=Math.max(1,item.height||Math.abs(item.transform?.[3])||10);
    if(!line||Math.abs(y-line.y)>h*.45||x<line.left-h||x-line.right>h*4){line={first:item.index,last:item.index,left:x,right:x+(item.width||0),y,h,font:item.fontName,text:item.str};lines.push(line);}
    else {line.last=item.index;line.right=Math.max(line.right,x+(item.width||0));line.text+=' '+item.str;}
  }
  const at=lines.findIndex(l=>index>=l.first&&index<=l.last);if(at<0)return {first:index,last:index};
  const widths=lines.filter(l=>Math.abs(l.left-lines[at].left)<lines[at].h*4).map(l=>l.right-l.left).sort((a,b)=>a-b);
  const normalWidth=widths[Math.floor(widths.length*.7)]||1;
  function boundary(a,b){
    const h=Math.max(a.h,b.h),gap=a.y-b.y;
    const heading=l=>l.text.length<90&&/^\d+(?:\.\d+)*\s+[^\d]/.test(l.text.trim());
    return heading(a)||heading(b)||gap<0||gap>h*1.85||Math.abs(a.left-b.left)>h*4||Math.abs(a.h-b.h)>h*.2||b.left-a.left>h*.7||(a.font&&b.font&&a.font!==b.font)||(/[.!?。！？][”'"）)]?$/.test(a.text.trim())&&a.right-a.left<normalWidth*.8)||(/[:：]$/.test(a.text.trim())&&gap>h*1.1);
  }
  let first=at,last=at;while(first>0&&!boundary(lines[first-1],lines[first]))first--;while(last<lines.length-1&&!boundary(lines[last],lines[last+1]))last++;
  return {first:lines[first].first,last:lines[last].last};
}
export function paragraphBounds(items,index,paper,pageIndex) {
  const selected=items[index],sameColumn=items.filter(i=>i.column===selected.column).sort((a,b)=>selected.column===undefined?a.index-b.index:Math.abs(a.transform[5]-b.transform[5])>Math.max(a.height,b.height,5)*.4?b.transform[5]-a.transform[5]:a.transform[4]-b.transform[4]);
  const page=paper.pageRanges?.find(r=>r.pageIndex===pageIndex);
  if(page&&graphUsable(paper)){
    const at=page.start+items[index].start;
    const node=paper.graph.paragraphs.find(p=>at>=p.start&&at<p.end);
    if(node){const included=items.filter(i=>page.start+i.end>node.start&&page.start+i.start<node.end);
      if(included.length&&included.every(i=>i.column===selected.column)){const ordered=sameColumn.filter(i=>included.includes(i));return {first:ordered[0].index,last:ordered.at(-1).index,text:ordered.map(i=>i.text).join('').trim(),exact:true};}}
  }
  const local=sameColumn.map((item,i)=>({...item,index:i})),bounds=layoutParagraph(local,sameColumn.indexOf(selected)),chosen=sameColumn.slice(bounds.first,bounds.last+1);
  return {first:chosen[0].index,last:chosen.at(-1).index,text:chosen.map(i=>i.text).join('').trim(),exact:false};
}
export function expandParagraph(reader,paper,selection=getSelection()) {
  const element=selection?.anchorNode?.nodeType===1?selection.anchorNode:selection?.anchorNode?.parentElement;
  if(!element||!reader.host.contains(element)||!selection.toString().trim())throw new Error('请先在原文中选几个字');
  const page=reader.pageForSelection(selection),item=reader.rendered.get(page),word=element.closest('.word-page');
  const range=document.createRange();let result;
  if(word){const block=element.closest('p,li,td,th,h1,h2,h3,h4,blockquote')||word;range.selectNodeContents(block);result={text:block.textContent.trim(),exact:true};}
  else {
    let index=Number(element.closest('[data-text-index]')?.dataset.textIndex);
    if(!Number.isInteger(index)||!item?.items){
      if(!item?.items)throw new Error('本页文字还未准备好，请稍后再试');
      const prefix=range.cloneRange();prefix.selectNodeContents(element.closest('.reflow'));prefix.setEnd(selection.anchorNode,selection.anchorOffset);const offset=prefix.toString().length;
      index=item.items.findIndex(i=>i.start<=offset&&i.end>offset);
    }
    if(index<0)throw new Error('未定位到段落，请重新选择');
    result=paragraphBounds(item.items,index,paper,page-1);
    if(item.layer){const first=item.layer.textDivs[result.first],last=item.layer.textDivs[result.last];range.setStartBefore(first);range.setEndAfter(last);}
    else {const node=element.closest('.reflow').firstChild;range.setStart(node,item.items[result.first].start);range.setEnd(node,Math.min(node.length,item.items[result.last].end));}
  }
  selection.removeAllRanges();selection.addRange(range);return {...result,page,fingerprint:selection.toString()};
}
