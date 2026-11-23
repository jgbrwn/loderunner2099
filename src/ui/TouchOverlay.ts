import { toggleFullscreen, fullscreenSupported } from '../platform/fullscreen';
// DOM touch controls that live OUTSIDE the playfield. Landscape: D-pad in the left gutter, dig buttons in the
// right gutter (the Phaser canvas is fitted into the space between). Portrait: game on top, controller below.
// Only active on touch devices (or with ?touch=1). Options (size/opacity/left-handed) persist in localStorage.
import type Phaser from 'phaser';
import { getInput, StateSource, emptyActions, type Action, type InputActions } from '../input/InputManager';
import { makeDpad, makeButton, DPAD_SVG, WIDGET_CSS, type Dir } from './dpad';
import { keepAwake } from '../platform/wakeLock';

export interface TouchOptions { size: number; opacity: number; leftHanded: boolean }
const KEY = 'lr2099.touch';
const DEFAULTS: TouchOptions = { size: 1, opacity: 0.85, leftHanded: false };
export function loadTouchOptions(): TouchOptions {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function isTouchDevice(): boolean {
  if (/[?&]touch=1/.test(location.search)) return true;
  if (/[?&]touch=0/.test(location.search)) return false;
  return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
}

const CSS = WIDGET_CSS + `
#touch-ui{position:fixed;inset:0;pointer-events:none;z-index:20;opacity:var(--op);font-family:monospace}
#touch-ui>*{pointer-events:auto;position:absolute}
#touch-ui .dpad{--c:#00ffff;width:var(--dp);height:var(--dp)}
#touch-ui .dig{--c:#ff2bd6;width:var(--bt);height:var(--bt);font-size:calc(var(--bt)*.22)}
#touch-ui .sm{--c:#8af;width:var(--sm);height:var(--sm);border-radius:12px;font-size:calc(var(--sm)*.42)}
#touch-opts{position:fixed;inset:0;z-index:30;background:rgba(5,1,15,.92);color:#0ff;display:none;
 align-items:center;justify-content:center;font:16px monospace}
#touch-opts.open{display:flex}
#touch-opts .box{border:2px solid #0ff;border-radius:12px;padding:18px 22px;box-shadow:0 0 20px #0ff6;min-width:260px}
#touch-opts label{display:flex;justify-content:space-between;gap:16px;margin:12px 0;align-items:center}
#touch-opts button{font:700 16px monospace;background:#0ff;color:#05010f;border:0;border-radius:8px;padding:10px 18px;width:100%}
`;

type Rect = { x: number; y: number; w: number; h: number };

export class TouchOverlay {
  private root = document.createElement('div');
  private opts = loadTouchOptions();
  private held = emptyActions();
  private tapped = emptyActions();
  private releaseDpad: () => void = () => {};
  private els: Record<string, HTMLElement> = {};
  private disposers: Array<() => void> = [];

  constructor(private game: Phaser.Game) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root.id = 'touch-ui';
    this.root.innerHTML = `<div class="dpad">${DPAD_SVG}</div>
      <div class="tbtn dig" data-a="digLeft">◀DIG</div><div class="tbtn dig" data-a="digRight">DIG▶</div>
      <div class="tbtn sm" data-a="pause" aria-label="Pause">❚❚</div><div class="tbtn sm fs" aria-label="Fullscreen">⛶</div>
      <div class="tbtn sm opt" aria-label="Touch options">⚙</div>`;
    document.body.appendChild(this.root);
    for (const el of Array.from(this.root.children) as HTMLElement[]) {
      const a = el.dataset.a as Action | undefined;
      if (a) { this.els[a] = el; makeButton(el, d => this.set(a, d), a === 'pause' || a === 'back' ? 20 : 12); }
    }
    this.els.back = this.root.querySelector('.fs')!;
    this.els.back.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); void toggleFullscreen(); });
    if (!fullscreenSupported()) this.els.back.style.visibility = 'hidden';
    this.els.dpad = this.root.querySelector('.dpad')!;
    this.els.opt = this.root.querySelector('.opt')!;
    this.els.opt.addEventListener('click', () => this.openOptions());
    let cur: Dir = null, cur2: Dir = null;
    this.releaseDpad = makeDpad(this.els.dpad, (d, d2) => {
      if (cur) this.set(cur, false);
      if (cur2) this.set(cur2, false);
      cur = d; cur2 = d2;
      if (d) this.set(d, true);
      if (d2) this.set(d2, true);
    });
    this.disposers.push(getInput().addSource(new StateSource(0, () => this.read())));
    this.disposers.push(keepAwake(() => !!this.game.scene?.isActive?.('GameScene')));
    const relayout = () => this.layout();
    addEventListener('resize', relayout);
    screen.orientation?.addEventListener?.('change', relayout);
    visualViewport?.addEventListener('resize', relayout);
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    this.layout();
  }

  private set(a: Action, down: boolean): void {
    this.held[a] = down;
    if (down) this.tapped[a] = true; // latch: a tap shorter than one frame still registers
  }
  private read(): Partial<InputActions> {
    const out = { ...this.held };
    for (const k in this.tapped) if (this.tapped[k as Action]) { out[k as Action] = true; this.tapped[k as Action] = false; }
    return out;
  }
  private releaseAll(): void {
    this.releaseDpad();
    this.held = emptyActions();
    for (const el of Object.values(this.els)) el.classList.remove('on');
  }

  private safe(): { t: number; r: number; b: number; l: number } {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(p);
    const s = getComputedStyle(p);
    const r = { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 };
    p.remove();
    return r;
  }

  /** Compute gutters/controller area, place widgets and fit the game container into the remaining rect. */
  layout(): void {
    const W = innerWidth, H = innerHeight, s = this.safe(), k = this.opts.size;
    const gw = this.game.scale.gameSize.width || 960, gh = this.game.scale.gameSize.height || 540;
    const st = this.root.style;
    st.setProperty('--op', String(this.opts.opacity));
    const place = (el: HTMLElement, x: number, y: number) => { el.style.left = `${x}px`; el.style.top = `${y}px`; };
    let game: Rect;
    const lefty = this.opts.leftHanded;
    if (W >= H) {
      // landscape: gutters at least big enough for a comfortable D-pad
      const usableH = H - s.t - s.b;
      const g = Math.round(Math.min(W * 0.26, Math.max(120, usableH * 0.4 * k)));
      const gl = g + s.l, gr = g + s.r;
      game = { x: gl, y: s.t, w: W - gl - gr, h: usableH };
      const dp = Math.min(g * 0.94, usableH * 0.5), bt = Math.min(g * 0.46, usableH * 0.26), sm = Math.max(36, Math.min(48, g * 0.3));
      st.setProperty('--dp', `${dp}px`); st.setProperty('--bt', `${bt}px`); st.setProperty('--sm', `${sm}px`);
      const leftX = s.l + (g - dp) / 2, rightX = W - gr;
      const padX = lefty ? rightX + (g - dp) / 2 : leftX;
      const btnBase = lefty ? s.l : rightX;
      place(this.els.dpad, padX, s.t + usableH * 0.62 - dp / 2);
      // dig buttons: staggered like a classic pad (digRight higher/outer)
      const by = s.t + usableH * 0.62;
      place(this.els.digLeft, btnBase + g * 0.04, by - bt * 0.15);
      place(this.els.digRight, btnBase + g * 0.96 - bt, by - bt * 1.05);
      const smY = s.t + 8;
      place(this.els.pause, btnBase + g - sm - 6, smY);
      place(this.els.back, btnBase + 6, smY);
      place(this.els.opt, (lefty ? rightX : s.l) + 6, smY);
    } else {
      // portrait: game on top, controller below
      const gameH = Math.min((W - s.l - s.r) * gh / gw, H * 0.55);
      game = { x: s.l, y: s.t, w: W - s.l - s.r, h: gameH };
      const top = s.t + gameH, ch = H - top - s.b;
      const dp = Math.min(W * 0.42 * k, ch * 0.75, W * 0.46), bt = Math.min(W * 0.2 * k, ch * 0.4, W * 0.22), sm = 44;
      st.setProperty('--dp', `${dp}px`); st.setProperty('--bt', `${bt}px`); st.setProperty('--sm', `${sm}px`);
      const cy = top + sm + 16 + (ch - sm - 16) / 2;
      const m = 14 + s.l;
      place(this.els.dpad, lefty ? W - m - dp : m, cy - dp / 2);
      const bx = lefty ? m : W - m - bt * 2.1;
      place(this.els.digLeft, bx, cy - bt * 0.2);
      place(this.els.digRight, bx + bt * 1.1, cy - bt * 0.9);
      place(this.els.back, W / 2 - sm * 1.7, top + 10);
      place(this.els.pause, W / 2 - sm / 2, top + 10);
      place(this.els.opt, W / 2 + sm * 0.7, top + 10);
    }
    const c = document.getElementById('game-container');
    if (c) Object.assign(c.style, { left: `${game.x}px`, top: `${game.y}px`, width: `${game.w}px`, height: `${game.h}px`, right: 'auto', bottom: 'auto' });
    this.game.scale?.refresh?.();
  }

  private openOptions(): void {
    let p = document.getElementById('touch-opts');
    if (!p) {
      p = document.createElement('div');
      p.id = 'touch-opts';
      p.innerHTML = `<div class="box"><b>TOUCH CONTROLS</b>
        <label>Size <input type="range" min="0.7" max="1.4" step="0.05" name="size"></label>
        <label>Opacity <input type="range" min="0.25" max="1" step="0.05" name="opacity"></label>
        <label>Left-handed <input type="checkbox" name="leftHanded"></label>
        <button>DONE</button></div>`;
      document.body.appendChild(p);
      p.addEventListener('input', e => {
        const t = e.target as HTMLInputElement;
        (this.opts as any)[t.name] = t.type === 'checkbox' ? t.checked : parseFloat(t.value);
        localStorage.setItem(KEY, JSON.stringify(this.opts));
        this.layout();
      });
      p.querySelector('button')!.addEventListener('click', () => p!.classList.remove('open'));
    }
    for (const i of Array.from(p.querySelectorAll('input'))) {
      const v = (this.opts as any)[i.name];
      if (i.type === 'checkbox') i.checked = v; else i.value = String(v);
    }
    this.releaseAll();
    p.classList.add('open');
  }

  destroy(): void {
    this.disposers.forEach(d => d());
    this.root.remove();
  }
}

/** Create the overlay if this is a touch device. Returns null otherwise. */
export function initTouchOverlay(game: Phaser.Game): TouchOverlay | null {
  if (!isTouchDevice()) return null;
  document.documentElement.classList.add('touch');
  return new TouchOverlay(game);
}
