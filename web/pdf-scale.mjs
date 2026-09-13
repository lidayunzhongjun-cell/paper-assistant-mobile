// Keep text sharp on high-density phones, while bounding one page's RGBA allocation.
export function renderPixels(width, height, density = 1) {
  if (!(width > 0 && height > 0)) throw new Error('PDF 页面尺寸无效');
  const requested = Math.max(1, Number(density) || 1);
  const ratio = Math.min(requested, Math.sqrt(16_000_000 / (width * height)), 8192 / width, 8192 / height);
  const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
  return { width: w, height: h, transform: [w / width, 0, 0, h / height, 0, 0] };
}
