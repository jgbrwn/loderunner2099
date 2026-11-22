import { CONFIG } from '../config';

export interface Rect { x: number; y: number; w: number; h: number }
/** Where one playfield (+ its HUD bar) is drawn. Field-local coords are 32px tiles; `scale` maps them to screen. */
export interface FieldLayout { x: number; y: number; scale: number; hud: Rect }

export const FIELD_W = CONFIG.GRID_WIDTH * CONFIG.TILE_SIZE;   // 896
export const FIELD_H = CONFIG.GRID_HEIGHT * CONFIG.TILE_SIZE;  // 512

/**
 * Layout for 1 field (single / co-op) or 2 fields (split-screen versus) inside a screen
 * of `w`x`h` base pixels. One field: 1:1 under a slim HUD. Two fields: side by side at 0.5,
 * each with its own HUD bar above it.
 */
export function computeLayout(fields: 1 | 2, w = CONFIG.GAME_WIDTH, h = CONFIG.GAME_HEIGHT): FieldLayout[] {
  const hudH = CONFIG.HUD_HEIGHT;
  if (fields === 1) {
    const scale = Math.min(1, (h - hudH) / FIELD_H, w / FIELD_W);
    const fw = FIELD_W * scale, fh = FIELD_H * scale;
    const x = Math.round((w - fw) / 2), y = Math.round(hudH + (h - hudH - fh) / 2);
    return [{ x, y, scale, hud: { x: 0, y: 0, w, h: hudH } }];
  }
  const gap = 16;
  // snap so a tile is a whole number of pixels (keeps rails/columns aligned)
  const scale = Math.floor(Math.min((w - gap * 3) / 2 / FIELD_W, (h - hudH * 2) / FIELD_H) * CONFIG.TILE_SIZE) / CONFIG.TILE_SIZE;
  const fw = FIELD_W * scale, fh = FIELD_H * scale;
  const y = Math.round((h - fh - hudH) / 2 + hudH);
  const out: FieldLayout[] = [];
  for (let i = 0; i < 2; i++) {
    const x = Math.round(gap + i * (fw + gap) + (w - gap * 3 - fw * 2) / 2);
    out.push({ x, y, scale, hud: { x, y: y - hudH, w: fw, h: hudH } });
  }
  return out;
}

export function reducedMotion(): boolean {
  try {
    const v = localStorage.getItem('lr2099.reducedMotion');
    if (v !== null) return v === '1' || v === 'true';
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}
