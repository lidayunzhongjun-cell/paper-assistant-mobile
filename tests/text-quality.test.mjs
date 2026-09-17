import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanImportedHeading,looksCorruptText} from '../web/text-quality.mjs';
import {cleanOcrText} from '../web/ocr-selection.mjs';
import {compactConversation} from '../web/compact-graph.mjs';
import {summaryNavigation} from '../web/local-navigation.mjs';

test('broken PDF character maps are detected without rejecting ordinary formulas',()=>{
  const broken=`基于 I'E;I*E 的求解方法 $GHIH 年# 0)41-,和 D,>><'44,提出了一种基于 SYD 求解的抽象精化 $ ,;759,>51*-M981-B'-5% 方法来验证神经网络`;
  assert.equal(looksCorruptText(broken),true);
  assert.equal(looksCorruptText('设 $f(x)=x^2$，当 x > 0 时，模型满足约束并给出确定性结果。'),false);
  assert.equal(looksCorruptText('本文使用 SMT/SAT 求解器验证神经网络的确定性保证。'),false);
});

test('imported headings remove repeated markdown and quarantine corrupt lines',()=>{
  assert.equal(cleanImportedHeading('# # 贝尔法斯特女王大学 # 贝尔法斯特'),'贝尔法斯特女王大学 · 贝尔法斯特');
  assert.equal(cleanImportedHeading('# $!" 人工智能系统安全内涵'),'人工智能系统安全内涵');
  const nav=summaryNavigation({name:'guide.txt',text:'# 正常章节\n# % 的上述近似 $ * T \' 9 M # # * > 51 B，给定一个安全集合\n可靠结论'});
  assert.equal(nav.corruptLines,1);assert.equal(nav.nodes[1].title,'[疑似乱码内容，未作为章节标题]');assert.equal(nav.nodes[1].candidates.length,0);
});

test('OCR selection is the only source sent when PDF text mapping is corrupt',()=>{
  const thread={selection:'基于 SMT 的抽象精化方法用于验证神经网络。',selectionSource:'offline-ocr',messages:[]};
  const paper={id:'p',title:'论文',rawText:'$GHIH # 0)41-, D,>>乱码原文',overview:''};
  const request=compactConversation(paper,thread,'请精读');
  const payload=JSON.stringify(request.messages);
  assert.match(payload,/基于 SMT 的抽象精化方法/);assert.match(payload,/设备内 OCR/);assert.ok(!payload.includes('$GHIH'));
  assert.equal(cleanOcrText('验证 神经 网络\n能够 返回 结果。'),'验证神经网络能够返回结果。');
});
