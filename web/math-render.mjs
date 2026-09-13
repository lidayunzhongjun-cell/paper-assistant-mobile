import katex from 'katex';
import { escape, answerHTML } from '../../paper-assistant-next/src/render.mjs';

// Protect formulas before Markdown parses underscores, pipes and line breaks.
// Code stays literal; model HTML and untrusted TeX commands never become active content.
export function renderMath(text, render = escape) {
  const source = String(text), values = [];
  let prefix = 'MATHPLACEHOLDER';
  while (source.includes(prefix)) prefix += 'X';
  const pattern = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|(?<![\\\w])\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/g;
  const protectedText = source.replace(pattern, token => {
    if (token.startsWith('`')) return token;
    const displayMode = token.startsWith('\\[') || token.startsWith('$$');
    const trim = token.startsWith('$') && !displayMode ? 1 : 2;
    const expression = token.slice(trim, -trim);
    let html = escape(token);
    if (expression.length <= 10000) try {
      html = katex.renderToString(expression, { displayMode, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 500, maxSize: 10, output: 'htmlAndMathml' });
    } catch { /* Keep unsupported or malformed formulas readable. */ }
    const marker = prefix + values.length + 'END'; values.push(html); return marker;
  });
  return render(protectedText).replace(new RegExp(prefix + '(\\d+)END', 'g'), (_, i) => values[Number(i)]);
}
export const richText = text => renderMath(text, value => escape(value).replace(/\*\*([^*\n]{1,160})\*\*/g, '<strong>$1</strong>'));
export const richAnswer = text => renderMath(text, answerHTML);
