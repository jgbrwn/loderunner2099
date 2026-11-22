// Shared touch widgets (DOM, Pointer Events): D-pad with slide-between-directions and diagonal→cardinal
// resolution, and press-and-hold buttons. Used by the in-game TouchOverlay and the phone pad page.
export type Dir = 'left' | 'right' | 'up' | 'down' | null;

export const vibrate = (ms: number): void => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

/** Resolve a vector (screen coords, y down) to a cardinal direction. Near the 45° diagonals the previous
 *  direction is kept (hysteresis) so a thumb resting on a diagonal doesn't flicker between two directions. */
export function resolveDir(dx: number, dy: number, radius: number, prev: Dir, dead = 0.22): Dir {
  const d = Math.hypot(dx, dy);
  if (d < radius * dead) return null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const horiz: Dir = dx < 0 ? 'left' : 'right', vert: Dir = dy < 0 ? 'up' : 'down';
  // within ~±12° of the diagonal: stick with prev if it's one of the two candidates
  if (prev && Math.abs(ax - ay) < d * 0.2 && (prev === horiz || prev === vert)) return prev;
  return ax > ay ? horiz : vert;
}

/** Turns `el` into a D-pad. onChange fires with the new direction (null on release). */
export function makeDpad(el: HTMLElement, onChange: (d: Dir) => void): () => void {
  let pid: number | null = null, dir: Dir = null;
  const set = (d: Dir) => {
    if (d === dir) return;
    dir = d;
    el.dataset.dir = d ?? '';
    if (d) vibrate(8);
    onChange(d);
  };
  const track = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    set(resolveDir(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, dir));
  };
  const down = (e: PointerEvent) => {
    if (pid !== null) return;
    pid = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    e.preventDefault();
    track(e);
  };
  const move = (e: PointerEvent) => { if (e.pointerId === pid) { e.preventDefault(); track(e); } };
  const up = (e: PointerEvent) => { if (e.pointerId === pid) { pid = null; set(null); } };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  return () => { pid = null; set(null); };
}

/** Hold-button: onChange(true) on press, (false) on release. Multi-touch safe. */
export function makeButton(el: HTMLElement, onChange: (down: boolean) => void, haptic = 12): void {
  const ids = new Set<number>();
  const down = (e: PointerEvent) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (ids.size === 0) { el.classList.add('on'); vibrate(haptic); onChange(true); }
    ids.add(e.pointerId);
  };
  const up = (e: PointerEvent) => {
    if (!ids.delete(e.pointerId) || ids.size) return;
    el.classList.remove('on');
    onChange(false);
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}

/** Inline SVG for a neon D-pad (arms highlight via [data-dir] CSS). */
export const DPAD_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
<circle cx="50" cy="50" r="48" class="dp-ring"/>
<path class="dp-arm dp-up" d="M38 8h24v28l-12 12-12-12z"/><path class="dp-arm dp-down" d="M38 92h24V64L50 52 38 64z"/>
<path class="dp-arm dp-left" d="M8 38v24h28l12-12-12-12z"/><path class="dp-arm dp-right" d="M92 38v24H64L52 50l12-12z"/>
<path class="dp-ico" d="M50 14l-6 9h12zM50 86l-6-9h12zM14 50l9-6v12zM86 50l-9-6v12z"/></svg>`;

/** CSS for DPAD_SVG + buttons; `--c` is the accent color. */
export const WIDGET_CSS = `
.dpad{touch-action:none;border-radius:50%;position:relative}
.dpad svg{width:100%;height:100%;display:block;overflow:visible}
.dp-ring{fill:rgba(0,255,255,.06);stroke:var(--c,#0ff);stroke-width:1.5;opacity:.7}
.dp-arm{fill:rgba(10,10,40,.85);stroke:var(--c,#0ff);stroke-width:1.5;stroke-linejoin:round}
.dp-ico{fill:var(--c,#0ff);opacity:.8}
.dpad[data-dir=up] .dp-up,.dpad[data-dir=down] .dp-down,.dpad[data-dir=left] .dp-left,.dpad[data-dir=right] .dp-right{fill:var(--c,#0ff);filter:drop-shadow(0 0 6px var(--c,#0ff))}
.tbtn{touch-action:none;user-select:none;-webkit-user-select:none;display:flex;align-items:center;justify-content:center;
 border:2px solid var(--c,#f0f);color:var(--c,#f0f);background:rgba(10,10,40,.85);border-radius:50%;
 font:700 16px/1 monospace;letter-spacing:1px;box-shadow:0 0 10px -2px var(--c,#f0f),inset 0 0 12px -4px var(--c,#f0f);transition:transform .05s}
.tbtn.on{background:var(--c,#f0f);color:#05010f;transform:scale(.94);box-shadow:0 0 22px var(--c,#f0f)}
`;
