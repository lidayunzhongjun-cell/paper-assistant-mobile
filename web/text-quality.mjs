const HAN = /[\u3400-\u9fff]/g;
const BAD = /[$#*"'<>\\^`|~]/g;

export function textQuality(value) {
  const text = String(value || '').normalize('NFKC');
  const han = (text.match(HAN) || []).length;
  const suspicious = (text.match(BAD) || []).length;
  const fatal = (text.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/g) || []).length;
  const clusters = (text.match(/(?:[$#*"'<>\\^`|~][\s,;:._-]*){3,}/g) || []).length;
  const noisyPrefix = /^[\s$#*"'<>\\^`|~;:,%0-9A-Z._-]{3,}(?=[\u3400-\u9fff])/i.test(text.trim()) ? 1 : 0;
  const score = fatal * 20 + clusters * 7 + noisyPrefix * 6 + Math.max(0, suspicious - Math.max(5, Math.floor(text.length * .045)));
  return { text, han, suspicious, fatal, clusters, noisyPrefix, score };
}

export function looksCorruptText(value) {
  const q = textQuality(value);
  if (q.fatal) return true;
  if (q.text.length < 12) return false;
  return q.score >= 12 || (q.han >= 8 && q.noisyPrefix && q.suspicious >= 4) || (q.han >= 8 && q.clusters >= 1 && q.suspicious >= Math.max(5, q.han * .1));
}

export function cleanImportedHeading(value) {
  let text = String(value || '').normalize('NFKC').trim();
  text = text.replace(/^(?:#{1,6}\s*)+/, '').trim();
  text = text.replace(/^[\s$#*"'<>\\^`|~;:,!?%._-]{2,}(?=[\u3400-\u9fffA-Za-z])/, '').trim();
  text = text.replace(/\s+#{1,6}\s+/g, ' · ').replace(/\s{2,}/g, ' ');
  return text;
}
