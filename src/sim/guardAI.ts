// Guard AI: classic Lode Runner (Doug Smith) row-scan algorithm + BFS helpers. Pure TS.
import { TileType } from '../config';
import type { Actor, Dir } from './types';
import type { World } from './World';

const T = TileType;
const ladder = (t: TileType) => t === T.LADDER || t === T.LADDER_EXIT;
/** "base" map view: dug holes still count as brick (classic). */
const base = (w: World, x: number, y: number): TileType => {
  const t = w.tile(x, y);
  return t === T.HOLE ? T.BRICK : t;
};
const blockV = (t: TileType) => t === T.BRICK || t === T.BRICK_HARD;          // stops downward travel
const blockH = (t: TileType) => t === T.BRICK || t === T.BRICK_HARD;  // trap bricks are passable
const floor = (t: TileType) => t === T.BRICK || t === T.BRICK_HARD || ladder(t);

/** Classic bestMove: chase target along the row if possible, else scanFloor. */
export function classicGuardMove(w: World, g: Actor, tgt: Actor): Dir {
  const gx = g.cx, gy = g.cy, rx = tgt.cx, ry = tgt.cy;
  const maxY = w.height - 1;
  if (gy === ry && tgt.mode !== 'fall') {
    let x = gx;
    while (x !== rx) {
      const cur = base(w, x, gy);
      const below = gy < maxY ? base(w, x, gy + 1) : T.BRICK_HARD;
      const nx = x + (x < rx ? 1 : -1);
      if (blockH(w.tile(nx, gy))) break;
      if (ladder(cur) || cur === T.POLE || floor(below) || w.guardAt(x, gy + 1, g)) x = nx;
      else break;
    }
    if (x === rx) {
      if (gx < rx) return 'R';
      if (gx > rx) return 'L';
      return g.ox < tgt.ox ? 'R' : 'L';
    }
  }
  return scanFloor(w, gx, gy, rx, ry);
}

function scanFloor(w: World, gx: number, gy: number, rx: number, ry: number): Dir {
  const maxX = w.width - 1, maxY = w.height - 1;
  let bestPath: Dir = null, bestRating = 255;
  const rate = (y: number, x: number, path: Dir) => {
    const r = y === ry ? Math.abs(x - rx) : y > ry ? y - ry + 200 : ry - y + 100;
    if (r < bestRating) { bestRating = r; bestPath = path; }
  };
  const sideOk = (x: number, y: number) => {
    const nb = base(w, x, y + 1);
    return blockV(nb) || ladder(nb) || base(w, x, y) === T.POLE;
  };
  const scanDown = (x: number, path: Dir) => {
    let y = gy;
    while (y < maxY && !blockV(base(w, x, y + 1))) {
      const b = base(w, x, y);
      if (b !== T.EMPTY) {
        if (x > 0 && sideOk(x - 1, y) && y >= ry) break;
        if (x < maxX && sideOk(x + 1, y) && y >= ry) break;
      }
      y++;
    }
    rate(y, x, path);
  };
  const scanUp = (x: number, path: Dir) => {
    let y = gy;
    while (y > 0 && ladder(base(w, x, y))) {
      y--;
      if (x > 0 && sideOk(x - 1, y) && y <= ry) break;
      if (x < maxX && sideOk(x + 1, y) && y <= ry) break;
    }
    rate(y, x, path);
  };
  const scanEnd = (d: -1 | 1) => {
    let x = gx;
    while (x + d >= 0 && x + d <= maxX) {
      const t = w.tile(x + d, gy);
      if (blockH(t)) break;
      const nb = base(w, x + d, gy + 1);
      x += d;
      if (!(ladder(t) || t === T.POLE || floor(nb))) break; // drop point: include and stop
    }
    return x;
  };
  const leftEnd = scanEnd(-1), rightEnd = scanEnd(1);
  if (gy < maxY && !blockV(base(w, gx, gy + 1))) scanDown(gx, 'D');
  if (ladder(base(w, gx, gy))) scanUp(gx, 'U');
  let path: Dir = 'L';
  let x = leftEnd;
  for (;;) {
    if (x === gx) {
      if (path === 'L' && rightEnd !== gx) { path = 'R'; x = rightEnd; } else break;
    }
    if (gy < maxY && !blockV(base(w, x, gy + 1))) scanDown(x, path);
    if (ladder(base(w, x, gy))) scanUp(x, path);
    x += path === 'L' ? 1 : -1;
  }
  return bestPath;
}

/** Static move graph on cells (ignores other actors). withDig adds player dig-down transitions. */
export function moveGraph(w: World, x: number, y: number, withDig = false): [Dir, number, number][] {
  const out: [Dir, number, number][] = [];
  const t = w.tile(x, y) === T.HOLE ? T.EMPTY : w.tile(x, y);
  const below = base(w, x, y + 1);
  const solid = (xx: number, yy: number) => blockH(base(w, xx, yy));
  const falls = !ladder(t) && t !== T.POLE && !floor(below) && y + 1 < w.height;
  if (falls) { out.push(['D', x, y + 1]); return out; }
  if (!solid(x - 1, y) && x > 0) out.push(['L', x - 1, y]);
  if (!solid(x + 1, y) && x < w.width - 1) out.push(['R', x + 1, y]);
  if (ladder(t) && y > 0 && !solid(x, y - 1)) out.push(['U', x, y - 1]);
  if ((ladder(t) || ladder(below) || t === T.POLE) && y + 1 < w.height && !solid(x, y + 1)) out.push(['D', x, y + 1]);
  if (withDig) {
    for (const d of [-1, 1]) {
      if (w.tile(x + d, y + 1) === T.BRICK && w.tile(x + d, y) === T.EMPTY) out.push([d < 0 ? 'L' : 'R', x + d, y + 1]);
    }
  }
  return out;
}

function bfs(w: World, sx: number, sy: number, goal: (x: number, y: number) => boolean): { dir: Dir; dist: number } | null {
  if (goal(sx, sy)) return { dir: null, dist: 0 };
  const W = w.width;
  const seen = new Uint8Array(W * w.height);
  const first: Dir[] = new Array(W * w.height).fill(null);
  const dist = new Int16Array(W * w.height);
  const q: number[] = [sy * W + sx];
  seen[sy * W + sx] = 1;
  for (let i = 0; i < q.length; i++) {
    const c = q[i], x = c % W, y = (c / W) | 0;
    for (const [d, nx, ny] of moveGraph(w, x, y)) {
      const n = ny * W + nx;
      if (seen[n]) continue;
      seen[n] = 1;
      first[n] = i === 0 ? d : first[c];
      dist[n] = dist[c] + 1;
      if (goal(nx, ny)) return { dir: first[n], dist: dist[n] };
      q.push(n);
    }
  }
  return null;
}

export function bfsFirstDir(w: World, sx: number, sy: number, goal: (x: number, y: number) => boolean): Dir {
  return bfs(w, sx, sy, goal)?.dir ?? null;
}
export function bfsDist(w: World, sx: number, sy: number, goal: (x: number, y: number) => boolean): number {
  return bfs(w, sx, sy, goal)?.dist ?? -1;
}
