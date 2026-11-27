// Persisted user options (localStorage). Menus write; GameScene/FieldView read at scene start.
import { CONFIG, THEMES } from '../config';

const P = 'lr2099.';
const get = (k: string): string | null => { try { return localStorage.getItem(P + k); } catch { return null; } };
const set = (k: string, v: string | null): void => {
  try { if (v === null) localStorage.removeItem(P + k); else localStorage.setItem(P + k, v); } catch { /* private mode */ }
};

export const Settings = {
  /** a THEMES key, or 'auto' (Auto Tour: art changes every 2–3 levels). One-time migration: players still on the
   *  old default (unset / cyber) move to Auto Tour; any other explicit pick is kept as a fixed theme. */
  get theme(): string {
    if (get('artV') !== '1') { set('artV', '1'); const old = get('theme'); if (!old || old === 'cyber') set('theme', 'auto'); }
    const t = get('theme'); return t === 'auto' || (t && THEMES[t]) ? t : 'auto';
  },
  set theme(v: string) { set('theme', v); },
  get crt(): boolean { return get('crt') === '1'; },
  set crt(v: boolean) { set('crt', v ? '1' : '0'); },
  /** index into CONFIG.SPEED_MULTIPLIERS (default 1.0x) */
  get speedIndex(): number {
    const i = Number(get('speed'));
    return get('speed') !== null && i >= 0 && i < CONFIG.SPEED_MULTIPLIERS.length ? i : CONFIG.SPEED_MULTIPLIERS.indexOf(1);
  },
  set speedIndex(v: number) { set('speed', String(v)); },
  /** 'auto' follows prefers-reduced-motion (read by graphics/Layout.reducedMotion()) */
  get reducedMotion(): 'auto' | 'on' | 'off' { const v = get('reducedMotion'); return v === null ? 'auto' : v === '1' || v === 'true' ? 'on' : 'off'; },
  set reducedMotion(v: 'auto' | 'on' | 'off') { set('reducedMotion', v === 'auto' ? null : v === 'on' ? '1' : '0'); },
  /** TV idle screen after N minutes without input (0 = never) */
  get idleMinutes(): number { const v = get('idleMin'); return v === null ? 5 : Math.max(0, Number(v) || 0); },
  set idleMinutes(v: number) { set('idleMin', String(v)); },
  /** switch music to Radio Paradise while the idle screen shows */
  get playerName(): string { return (get('playerName') || '').slice(0, 12); },
  set playerName(v: string) { set('playerName', v.slice(0, 12)); },
  get remoteSideways(): boolean { return get('remoteSideways') === '1'; },
  set remoteSideways(v: boolean) { set('remoteSideways', v ? '1' : '0'); },
  get idleRadio(): 'off' | 'rp' | 'soma' { const v = get('idleRadio'); return v === '1' || v === 'rp' ? 'rp' : v === 'soma' ? 'soma' : 'off'; },
  set idleRadio(v: 'off' | 'rp' | 'soma') { set('idleRadio', v); },
  /** practice mode: deaths never cost a life (single / co-op; runs never reach the high-score table) */
  get unlimitedLives(): boolean { return get('unlimitedLives') === '1'; },
  set unlimitedLives(v: boolean) { set('unlimitedLives', v ? '1' : '0'); },
  get lastSeed(): string { return get('lastSeed') ?? ''; },
  set lastSeed(v: string) { set('lastSeed', v); },
};
