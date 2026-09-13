export function pinchFrame(start, a, b) {
  const x=(a.clientX+b.clientX)/2,y=(a.clientY+b.clientY)/2;
  const zoom=Math.min(4,Math.max(.5,start.zoom*Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)/Math.max(1,start.distance)));
  const scale=zoom/start.zoom;
  return {zoom,x,y,scale,tx:x-start.left-scale*(start.x-start.left),ty:y-start.top-scale*(start.y-start.top)};
}
