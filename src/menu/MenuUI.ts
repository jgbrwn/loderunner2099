// DOM menu overlay (over the attract demo canvas). Focus-driven: keyboard / gamepad / remote / phone pads via
// InputManager (polled by the scene), plus mouse & touch. TV variant: overscan-safe, bigger type, side panel.
import { getInput } from '../input/InputManager';
import { getSoundManager } from '../audio/SoundManager';

export interface Item {
  label: string | (() => string);
  value?: () => string;                 // shown as ◀ value ▶ (cycle items)
  act?: () => void;                     // OK / click
  cycle?: (dir: 1 | -1) => void;        // ◀ ▶
  visible?: () => boolean;
  input?: HTMLInputElement;             // text field item
  cls?: string;
}
export interface Page {
  title?: string;
  items: Item[];
  body?: string | (() => HTMLElement | string);
  focus?: number;                       // initially focused item
  side?: boolean;                       // TV: show the pairing panel next to this page
  onBack?: () => boolean | void;
}

const CSS = `
body.lr-menu-open #touch-ui,body.lr-menu-open #touch-opts{visibility:hidden!important}
#lr-menu{position:fixed;inset:0;z-index:25;display:flex;flex-direction:column;align-items:center;color:#d8ffff;
 font-family:'Courier New',monospace;user-select:none;-webkit-user-select:none;overflow:hidden;
 padding:max(2vh,env(safe-area-inset-top)) max(3vw,env(safe-area-inset-right)) max(2vh,env(safe-area-inset-bottom)) max(3vw,env(safe-area-inset-left));
 background:radial-gradient(ellipse at 50% 45%,rgba(5,1,15,.62),rgba(5,1,15,.9) 70%);animation:lrmIn .35s ease-out}
@keyframes lrmIn{from{opacity:0}to{opacity:1}}
#lr-menu .logo{text-align:center;line-height:1;margin:1vh 0 2vh;flex:none}
#lr-menu .l1{display:block;font-size:clamp(28px,7.5vmin,76px);font-weight:900;letter-spacing:.08em;color:#e8ffff;
 text-shadow:0 0 3px #fff,0 0 10px #0ff,0 0 24px #0ff,0 0 48px #08f;animation:lrmFlick 5s infinite}
#lr-menu .l2{display:inline-block;font-size:clamp(22px,5.5vmin,56px);font-weight:900;letter-spacing:.45em;margin-left:.45em;color:#ffe6fb;
 text-shadow:0 0 3px #fff,0 0 10px #f0f,0 0 26px #ff2bd6;animation:lrmPulse 2.2s ease-in-out infinite alternate}
#lr-menu .l1 i{font-style:normal;display:inline-block;animation:lrmWave 3.2s ease-in-out infinite;animation-delay:calc(var(--i)*.09s)}
@keyframes lrmFlick{0%,41%,43%,77%,79%,100%{opacity:1}42%,78%{opacity:.45}}
@keyframes lrmPulse{from{filter:brightness(.8)}to{filter:brightness(1.15)}}
@keyframes lrmWave{0%,70%,100%{transform:none}80%{transform:translateY(-.08em)}}
#lr-menu .main{flex:1;min-height:0;display:flex;gap:4vw;align-items:center;justify-content:center;width:100%}
#lr-menu .panel{width:min(94vw,480px);max-height:100%;overflow:auto;scrollbar-width:none;padding:4px}
#lr-menu .ttl{text-align:center;font-size:clamp(16px,3vmin,26px);letter-spacing:.3em;color:#ff7ef0;margin-bottom:1.2vh;text-shadow:0 0 10px #f0f}
#lr-menu .it{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;margin:5px 0;padding:6px 16px;
 font-size:clamp(16px,3.2vmin,26px);letter-spacing:.12em;border:1px solid rgba(0,255,255,.18);border-radius:6px;
 background:rgba(8,4,30,.82);backdrop-filter:blur(2px);cursor:pointer;transition:background .12s,border-color .12s,transform .12s,box-shadow .12s}
#lr-menu .it.f{border-color:#0ff;background:rgba(0,90,110,.45);color:#fff;transform:scale(1.03);
 box-shadow:0 0 12px rgba(0,255,255,.55),inset 0 0 14px rgba(0,255,255,.25);text-shadow:0 0 8px #0ff}
#lr-menu .it.f::before{content:'▶';color:#ff2bd6;margin-right:-4px;text-shadow:0 0 8px #f0f}
#lr-menu .it .lb{flex:1}
#lr-menu .it .v{color:#ffdd55;white-space:nowrap}
#lr-menu .it .v b{color:#0ff8;padding:0 .4em;cursor:pointer}
#lr-menu .it.dim{opacity:.7}
#lr-menu .it.accent{border-color:rgba(255,43,214,.5)}
#lr-menu .it input{flex:1;min-width:0;background:#000a;border:1px solid #0ff6;color:#fff;font:inherit;letter-spacing:.3em;padding:4px 8px;text-transform:uppercase;border-radius:4px}
#lr-menu .body{font-size:clamp(13px,2.4vmin,20px);line-height:1.5;color:#bde;margin:0 0 1.5vh;text-align:center}
#lr-menu .body table{margin:0 auto;border-collapse:collapse}
#lr-menu .body td{padding:1px 10px;text-align:left}
#lr-menu .body td.n{color:#ffdd55;text-align:right}
#lr-menu .foot{flex:none;font-size:clamp(11px,1.8vmin,15px);color:#7a8aaa;letter-spacing:.1em;text-align:center;margin-top:1vh;min-height:1.4em}
#lr-menu .toast{position:absolute;left:50%;bottom:9vh;transform:translateX(-50%);background:#0ff;color:#012;padding:8px 18px;border-radius:6px;
 font-weight:bold;letter-spacing:.1em;box-shadow:0 0 20px #0ff;opacity:0;transition:opacity .25s;pointer-events:none}
#lr-menu .toast.on{opacity:1}
#lr-menu .side{display:none}
@media (max-height:500px){#lr-menu .logo{margin:0 0 1vh}#lr-menu .it{min-height:36px;margin:3px 0;padding:3px 14px}}
@media (max-height:420px) and (orientation:landscape){#lr-menu .logo .l1{font-size:26px}#lr-menu .logo .l2{font-size:18px}}
@media (max-height:500px) and (orientation:landscape){#lr-menu{flex-direction:row!important;flex-wrap:wrap;align-content:center;align-items:center}#lr-menu .logo{width:36%;margin:0}#lr-menu .l1{font-size:clamp(26px,6.5vw,52px)}#lr-menu .main{width:62%;flex:none;height:92vh}#lr-menu .panel{width:min(58vw,460px)}#lr-menu .it{min-height:40px;margin:4px 0}#lr-menu .foot{display:none}}
/* TV: overscan-safe 5%, 10-foot sizes, side panel */
#lr-menu.tv{padding:5vh 5vw}
#lr-menu.tv .l1{font-size:9vh}#lr-menu.tv .l2{font-size:6vh}
#lr-menu.tv .panel{width:44vw}
#lr-menu.tv .it{font-size:3.2vh;min-height:5.4vh;margin:.7vh 0;padding:0 2.2vw}
#lr-menu.tv .ttl{font-size:3.4vh}
#lr-menu.tv .body{font-size:2.8vh}
#lr-menu.tv .foot{font-size:2.2vh}
#lr-menu.tv .side.on{display:flex}
#lr-menu .side{flex-direction:column;align-items:center;gap:1.6vh;padding:2.5vh 2vw;border:1px solid #ff2bd666;border-radius:12px;
 background:rgba(8,4,30,.7);box-shadow:0 0 30px rgba(255,43,214,.2);font-size:2.6vh;letter-spacing:.1em}
#lr-menu .qr{background:#fff;padding:1vh;border-radius:8px;width:26vh;height:26vh;image-rendering:pixelated}
#lr-menu .qr.big{width:44vh;height:44vh}
#lr-menu .code{font-size:7vh;font-weight:900;letter-spacing:.35em;margin-left:.35em;color:#fff;text-shadow:0 0 14px #0ff}
#lr-menu .slots{display:flex;gap:1.2vw}
#lr-menu .slot{min-width:12vw;padding:.8vh 1vw;border-radius:8px;border:2px dashed #557;color:#778;text-align:center;font-size:2.4vh}
#lr-menu .slot.on{border-style:solid;color:#fff}
#lr-menu .slot.p1.on{border-color:#00ff88;box-shadow:0 0 14px #00ff8866}
#lr-menu .slot.p2.on{border-color:#ffcc00;box-shadow:0 0 14px #ffcc0066}
#lr-menu .slot b{display:block;font-size:3vh}
#lr-menu .url{color:#8ab;font-size:2.2vh}
@media (prefers-reduced-motion:reduce){#lr-menu,#lr-menu *{animation:none!important;transition:none!important}}
`;

export class MenuUI {
  readonly root: HTMLDivElement;
  private panel: HTMLDivElement;
  private sideEl: HTMLDivElement;
  private foot: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private stack: { page: Page; idx: number }[] = [];
  private els: HTMLElement[] = [];
  private vis: Item[] = [];
  private toastT: ReturnType<typeof setTimeout> | undefined;
  private off: (() => void)[] = [];
  sideRender: ((el: HTMLElement, big: boolean) => void) | null = null;

  constructor(readonly tv: boolean) {
    if (!document.getElementById('lr-menu-css')) {
      const st = document.createElement('style');
      st.id = 'lr-menu-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const r = this.root = document.createElement('div');
    r.id = 'lr-menu';
    if (tv) r.classList.add('tv');
    const letters = [...'LODE RUNNER'].map((c, i) => c === ' ' ? ' ' : `<i style="--i:${i}">${c}</i>`).join('');
    r.innerHTML = `<div class="logo"><span class="l1">${letters}</span><span class="l2">2099</span></div>
      <div class="main"><div class="panel" role="menu"></div><div class="side"></div></div><div class="foot"></div><div class="toast"></div>`;
    this.panel = r.querySelector('.panel')!;
    this.sideEl = r.querySelector('.side')!;
    this.foot = r.querySelector('.foot')!;
    this.toastEl = r.querySelector('.toast')!;
    document.body.appendChild(r);
    document.body.classList.add('lr-menu-open');
    const touch = matchMedia('(pointer:coarse)').matches;
    this.foot.textContent = tv ? '▲▼ SELECT · OK CHOOSE · ◀▶ CHANGE · BACK' : touch ? '' : '↑↓ SELECT · ENTER CHOOSE · ←→ CHANGE · ESC BACK';
  }

  get page(): Page | undefined { return this.stack[this.stack.length - 1]?.page; }
  get depth(): number { return this.stack.length; }

  push(page: Page): void {
    this.stack.push({ page, idx: page.focus ?? 0 });
    this.render();
  }
  replace(page: Page): void { this.stack.pop(); this.push(page); }
  /** Back one page. Returns false at the root (caller decides: e.g. exit the TV app). */
  back(): boolean {
    const top = this.stack[this.stack.length - 1];
    if (top?.page.onBack?.() === true) return true;
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    getSoundManager().playMenuSelect();
    this.render();
    return true;
  }
  home(): void { this.stack.length = Math.min(this.stack.length, 1); this.render(); }

  /** Rebuild the current page (labels/values/visibility may have changed). */
  render(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    const { page } = top;
    this.panel.textContent = '';
    if (page.title) this.panel.insertAdjacentHTML('beforeend', `<div class="ttl">${page.title}</div>`);
    if (page.body) {
      const b = document.createElement('div');
      b.className = 'body';
      const c = typeof page.body === 'function' ? page.body() : page.body;
      if (typeof c === 'string') b.innerHTML = c; else b.appendChild(c);
      this.panel.appendChild(b);
    }
    this.vis = page.items.filter(it => !it.visible || it.visible());
    this.els = this.vis.map((it, i) => {
      const el = document.createElement('div');
      el.className = 'it' + (it.cls ? ' ' + it.cls : '');
      el.setAttribute('role', 'menuitem');
      if (it.input) {
        el.innerHTML = `<span class="lb">${lbl(it)}</span>`;
        el.appendChild(it.input);
      } else {
        el.innerHTML = `<span class="lb">${lbl(it)}</span>` + (it.value ? `<span class="v"><b data-d="-1">◀</b>${it.value()}<b data-d="1">▶</b></span>` : '');
      }
      el.addEventListener('pointerenter', ev => { if ((ev as PointerEvent).pointerType === 'mouse') this.focus(i, false); });
      el.addEventListener('click', ev => {
        if (it.input) { this.focus(i, false); return; }
        this.focus(i, false);
        const d = (ev.target as HTMLElement).dataset?.d;
        this.activate(d ? (Number(d) as 1 | -1) : 1);
      });
      this.panel.appendChild(el);
      return el;
    });
    top.idx = Math.max(0, Math.min(top.idx, this.els.length - 1));
    this.focus(top.idx, false);
    const side = this.tv && (page.side || !!this.sideRender && this.stack.length === 1);
    this.sideEl.classList.toggle('on', !!side && !!this.sideRender);
    this.renderSide();
  }

  renderSide(): void {
    const page = this.page;
    if (!this.sideRender || !this.tv || !this.sideEl.classList.contains('on')) return;
    this.sideRender(this.sideEl, !!page?.side);
  }

  private focus(i: number, sound = true): void {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.els.length) return;
    i = (i + this.els.length) % this.els.length;
    if (sound && i !== top.idx) getSoundManager().playMenuSelect();
    top.idx = i;
    this.els.forEach((e, j) => e.classList.toggle('f', j === i));
    this.els[i].scrollIntoView?.({ block: 'nearest' });
    const inp = this.vis[i].input;
    if (!inp && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  }

  private activate(dir: 1 | -1 = 1): void {
    const top = this.stack[this.stack.length - 1];
    const it = this.vis[top?.idx ?? -1];
    if (!it) return;
    if (it.input) { it.input.focus(); return; }
    if (it.cycle) { it.cycle(dir); getSoundManager().playMenuSelect(); this.render(); return; }
    if (it.act) { getSoundManager().playMenuConfirm(); it.act(); }
  }

  /** Poll InputManager (call every frame after im.update()). */
  poll(): void {
    const im = getInput();
    const typing = document.activeElement instanceof HTMLInputElement;
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    if (im.anyJustPressed('up')) this.focus(top.idx - 1);
    else if (im.anyJustPressed('down')) this.focus(top.idx + 1);
    if (typing) return;
    const it = this.vis[top.idx];
    if (it?.cycle && im.anyJustPressed('left')) this.activate(-1);
    else if (it?.cycle && im.anyJustPressed('right')) this.activate(1);
    if (im.anyJustPressed('confirm')) this.activate(1);
    else if (im.anyJustPressed('back')) this.back();
  }

  toast(msg: string, ms = 1800): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove('on'), ms);
  }

  onDestroy(fn: () => void): void { this.off.push(fn); }
  destroy(): void {
    clearTimeout(this.toastT);
    for (const f of this.off) f();
    this.off = [];
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    this.root.remove();
    document.body.classList.remove('lr-menu-open');
  }
}

const lbl = (it: Item) => (typeof it.label === 'function' ? it.label() : it.label);

/** Text input that submits on Enter and leaves the field on Escape. */
export function textInput(opts: { value: string; max: number; placeholder?: string; filter?: RegExp; onEnter: (v: string) => void }): HTMLInputElement {
  const el = document.createElement('input');
  el.value = opts.value;
  el.maxLength = opts.max;
  el.placeholder = opts.placeholder ?? '';
  el.spellcheck = false;
  el.autocapitalize = 'characters';
  el.autocomplete = 'off';
  el.addEventListener('input', () => { if (opts.filter) el.value = el.value.toUpperCase().replace(opts.filter, ''); });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { el.blur(); return; } // let the menu navigate away
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); el.blur(); opts.onEnter(el.value); }
    else if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
  });
  return el;
}
