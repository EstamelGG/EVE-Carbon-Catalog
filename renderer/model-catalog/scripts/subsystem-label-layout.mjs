// Keep the kill-mark label's 28px leader; only offset nearby bubbles to avoid collisions.
export function layoutSubsystemLabels(points, width, height, obstacles = []) {
  const margin = 12, gap = 8, leader = 28;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const overlap = (a,b) => Math.max(0, Math.min(a.x+a.width+gap,b.x+b.width)-Math.max(a.x-gap,b.x)) *
    Math.max(0, Math.min(a.y+a.height+gap,b.y+b.height)-Math.max(a.y-gap,b.y));
  const ordered = [...points].sort((a,b) => a.anchorX-b.anchorX);
  const result = [];
  for (const [i,p] of ordered.entries()) {
    const preferred = i < Math.ceil(ordered.length/2) ? 'left' : 'right';
    let best, bestScore = Infinity;
    for (const side of [preferred, preferred === 'left' ? 'right' : 'left']) {
      for (const offset of [0, -.5, .5, -1, 1, -1.5, 1.5]) {
        const candidate = {...p, side,
          x: clamp(side === 'left' ? p.anchorX-leader-p.width : p.anchorX+leader, margin, width-margin-p.width),
          y: clamp(p.anchorY-p.height/2+offset*(p.height+gap), margin, height-margin-p.height)};
        candidate.endX = side === 'left' ? candidate.x+p.width : candidate.x;
        candidate.endY = clamp(p.anchorY, candidate.y+10, candidate.y+p.height-10);
        const collisions = [...result, ...obstacles].reduce((sum, other) => sum+overlap(candidate,other), 0);
        const score = collisions*1000 + Math.hypot(candidate.endX-p.anchorX,candidate.endY-p.anchorY) +
          Math.abs(candidate.y+p.height/2-p.anchorY)*.2 + (side === preferred ? 0 : 8);
        if (score < bestScore) { best = candidate; bestScore = score; }
      }
    }
    result.push(best);
  }
  return result;
}
