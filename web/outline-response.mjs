// Normalize presentation fields without relaxing coverage of the original text.
const prose = value => typeof value === 'string' ? value.trim()
  : Array.isArray(value) && value.every(item => typeof item === 'string') ? value.map(item=>item.trim()).filter(Boolean).join('\n') : '';
const firstText = (...values) => values.map(prose).find(Boolean) || '';
const line = value => typeof value === 'number' ? value : typeof value === 'string' && /^\[?L?\d+\]?$/i.test(value.trim()) ? Number(value.replace(/[^\d]/g,'')) : NaN;
export function normalizeOutline(data) {
  if(!data || !Array.isArray(data.nodes) || !data.nodes.length)throw new Error('模型未返回段落节点，需要重试当前批次');
  const nodes=data.nodes.map((value,index)=>{
    if(!value || typeof value!=='object')throw new Error(`第 ${index+1} 个段落节点格式无效`);
    const n={...value};
    n.a=line(n.a??n.first);n.b=line(n.b??n.last);
    n.c=firstText(n.c,n.chapter);n.s=firstText(n.s,n.subsection);
    n.k=firstText(n.k,n.summary,n.core);
    if(!n.k)throw new Error(`第 ${index+1} 段（L${n.a}–L${n.b}）未返回摘要文字；请填写 k 字段`);
    const weights={'0':0,'1':1,'2':2,low:0,medium:1,high:2,'低':0,'中':1,'高':2};
    const weight=String(n.w??n.importance??'').trim().toLowerCase();
    n.importanceDefaulted=!Object.hasOwn(weights,weight);n.w=n.importanceDefaulted?1:weights[weight];
    const terms=n.t??n.terms;let entries=[];
    if(Array.isArray(terms))entries=terms;
    else if(terms && typeof terms==='object')entries=Object.entries(terms);
    n.t=entries.map(term=>Array.isArray(term)?[firstText(term[0]),firstText(term[1])]:[firstText(term?.name,term?.term),firstText(term?.definition,term?.meaning)])
      .filter(([name,definition])=>name&&definition);
    n.droppedTerms=entries.length-n.t.length;
    n.longCore=n.k.length>(n.w===2?220:90);
    return n;
  });
  const brief=firstText(data.brief,data.summary);
  return {...data,nodes,brief:brief||nodes.map(n=>n.k).join('\n'),briefFromNodes:!brief};
}
export function normalizeBrief(data) {
  const brief=firstText(data?.brief,data?.summary,data?.narrative);
  if(!brief)throw new Error('模型未返回全文核心文字；请填写 brief 字段');
  return {...data,brief};
}
