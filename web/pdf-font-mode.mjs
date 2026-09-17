export function resolveFontMode(setting='auto',width=0,height=0) {
  if (setting === 'path' || setting === 'web') return setting;
  const shortSide=Math.min(Number(width)||0,Number(height)||0);
  return shortSide >= 600 ? 'path' : 'web';
}

export function pdfFontOptions(mode) {
  const pathMode=mode==='path';
  return {disableFontFace:pathMode,useSystemFonts:!pathMode};
}
