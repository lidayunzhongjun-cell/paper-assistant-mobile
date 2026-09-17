import {escape} from '../../paper-assistant-next/src/render.mjs';
import {richText} from './math-render.mjs';
export function navigationHTML(graph){
  const nav=graph.navigation;if(!nav)return '';
  const children=new Map();for(const n of nav.nodes){if(!children.has(n.parent))children.set(n.parent,[]);children.get(n.parent).push(n);}
  const visible=id=>(children.get(id)||[]).filter(n=>!n.corrupt);
  const render=n=>`<details class="graph-branch navigation-branch" ${n.level&&!n.parent?'open':''}><summary>${escape(n.title.length>100?n.title.slice(0,100)+'…':n.title)}</summary><p>${richText(n.title)}</p>${n.candidates.length?'<div class="navigation-candidates">原文候选位置：'+n.candidates.map(c=>`<button data-node="${escape(c.paragraphId)}">${escape(c.paragraphId)} · 查看与追问</button>`).join('')+'</div>':'<p class="muted">尚未匹配原文位置，追问时按内容检索。</p>'}<button data-navigation="${escape(n.id)}">围绕此条追问</button>${visible(n.id).map(render).join('')}</details>`;
  return `<section class="imported-navigation"><h2>导入总结导航</h2><p class="muted">${nav.nodes.length-(nav.corruptLines||0)} 个可用条目 · 建图 0 次模型调用。原文候选由关键词匹配，需核对。${nav.corruptLines?` 另有 ${nav.corruptLines} 行疑似乱码留在原导入文件中，未显示、未作为标题或定位关键词。`:''}</p>${visible(null).map(render).join('')}<details class="graph-branch"><summary>独立附属术语表</summary>${nav.terms.map(t=>`<p><strong>${escape(t.name)}</strong>：${richText(t.definition)}</p>`).join('')||'<p class="muted">未识别到明确的术语表；相关解释仍保留在总结条目中。</p>'}</details><details class="graph-branch"><summary>跨章节共同术语</summary>${nav.edges.filter(e=>e.type==='共同术语').map(e=>`<p>${escape(e.from)} → ${escape(e.to)}：${escape(e.term)}（共同关键词，不代表因果关系）</p>`).join('')}</details></section>`;
}
