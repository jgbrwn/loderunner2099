// Attract-mode bot: BFS to the nearest free gold (then to the top row), digs in front of approaching guards.
import { TileType as T } from '../config';
import type { World } from '../sim/World';
import { moveGraph } from '../sim/guardAI';
import { NO_INPUT, type SimInput, type Dir } from '../sim/types';

export function botInput(w: World, memo: { dir: Dir; at: number }): SimInput {
  const p = w.players[0];
  if (!p || !p.alive) return NO_INPUT;
  const x = p.cx, y = p.cy;
  if (nearGuard(w, x, y) <= 2) { // too close: flee to the neighbour farthest from guards
    let best: Dir = null, bd = nearGuard(w, x, y);
    for (const [d, nx, ny] of moveGraph(w, x, y)) { const v = nearGuard(w, nx, ny); if (v > bd) { bd = v; best = d; } }
    if (best) { memo.dir = best; memo.at = w.tickCount; return { ...NO_INPUT, left: best === 'L', right: best === 'R', up: best === 'U', down: best === 'D' }; }
  }
  // defend: a guard approaching on this row → dig the brick in front of it
  for (const g of w.guards) {
    if (g.cy !== y || g.mode === 'trapped' || g.mode === 'dead') continue;
    const d = g.cx - x, side = Math.sign(d);
    if (Math.abs(d) >= 2 && Math.abs(d) <= 5 && w.tile(x + side, y + 1) === T.BRICK && w.tile(x + side, y) === T.EMPTY
        && !w.guardAt(x + side, y)) {
      return { ...NO_INPUT, digLeft: side < 0, digRight: side > 0 };
    }
  }
  if (w.tickCount - memo.at >= 6) { // re-plan a few times a second
    memo.at = w.tickCount;
    const golds = w.golds.filter(gd => !gd.collected && gd.carriedBy < 0);
    const goal = golds.length
      ? (gx: number, gy: number) => golds.some(gd => gd.x === gx && gd.y === gy)
      : (_gx: number, gy: number) => gy === 0;
    memo.dir = safeDir(w, x, y, goal);
  }
  const d = memo.dir;
  return { ...NO_INPUT, left: d === 'L', right: d === 'R', up: d === 'U', down: d === 'D' };
}


/** BFS that avoids cells next to free guards (falls back to ignoring guards). */
function safeDir(w: World, sx: number, sy: number, goal: (x: number, y: number) => boolean): Dir {
  const W = w.width, danger = new Uint8Array(W * w.height);
  for (const g of w.guards) {
    if (g.mode === 'trapped' || g.mode === 'dead' || g.mode === 'spawning') continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) {
      const gx = g.cx + dx, gy = g.cy + dy;
      if (gx >= 0 && gy >= 0 && gx < W && gy < w.height && Math.abs(dx) + Math.abs(dy) <= 2) danger[gy * W + gx] = 1;
    }
  }
  const run = (avoid: boolean): Dir | undefined => {
    const seen = new Uint8Array(W * w.height), first: Dir[] = [];
    const q = [sy * W + sx];
    seen[q[0]] = 1;
    for (let i = 0; i < q.length; i++) {
      const c = q[i], x = c % W, y = (c / W) | 0;
      for (const [d, nx, ny] of moveGraph(w, x, y)) {
        const n = ny * W + nx;
        if (seen[n] || (avoid && danger[n])) continue;
        seen[n] = 1;
        first[n] = i === 0 ? d : first[c];
        if (goal(nx, ny)) return first[n];
        q.push(n);
      }
    }
    return undefined;
  };
  const d = run(true);
  if (d !== undefined) return d;
  // no safe path: if a guard is close, step to the neighbour farthest from guards; else wait for an opening
  const near = (x: number, y: number) => nearGuard(w, x, y);
  if (near(sx, sy) > 3) return null;
  let best: Dir = null, bd = near(sx, sy);
  for (const [d, nx, ny] of moveGraph(w, sx, sy)) { const v = near(nx, ny); if (v > bd) { bd = v; best = d; } }
  return best ?? run(false) ?? null;
}

function nearGuard(w: World, x: number, y: number): number {
  let m = 99;
  for (const g of w.guards) {
    if (g.mode === 'trapped' || g.mode === 'dead' || g.mode === 'spawning') continue;
    m = Math.min(m, Math.abs(g.cx - x) + Math.abs(g.cy - y));
  }
  return m;
}
