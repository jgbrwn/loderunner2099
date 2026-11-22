// TV idle screen: after N minutes without input on the menu or a paused game. Neon scene, big clock,
// Radio Paradise now-playing card, slow drift + periodic relayout against burn-in. Any input returns.
import type Phaser from 'phaser';
import { getInput, ACTIONS } from '../input/InputManager';
import { getSoundManager } from '../audio/SoundManager';
import { Settings } from '../systems/Settings';

const CSS = `
#lr-idle{position:fixed;inset:0;z-index:80;background:rgba(5,1,15,.45);-webkit-backdrop-filter:blur(12px) brightness(.6) saturate(1.3);backdrop-filter:blur(12px) brightness(.6) saturate(1.3);color:#e8ffff;font-family:'Courier New',monospace;overflow:hidden;
 opacity:0;transition:opacity 1.2s;cursor:none}
#lr-idle.on{opacity:1}
#lr-idle .sky{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 40%,#05010fcc 100%)}
body.lr-idle-on #game-container{animation:lriBg 300s ease-in-out infinite alternate}
@keyframes lriBg{from{transform:translate(-1.5vw,-1.5vh) scale(1.06)}to{transform:translate(1.5vw,1.5vh) scale(1.1)}}
#lr-idle .sun{position:absolute;left:50%;top:30%;width:34vh;height:34vh;margin-left:-17vh;border-radius:50%;
 background:linear-gradient(#ffe066,#ff2bd6 70%);box-shadow:0 0 80px #ff2bd688;opacity:.55;
 -webkit-mask:repeating-linear-gradient(#000 0 7%,transparent 7% 9%);mask:repeating-linear-gradient(#000 0 7%,transparent 7% 9%)}
#lr-idle .grid{position:absolute;left:-50%;right:-50%;bottom:-8%;height:46%;transform:perspective(300px) rotateX(62deg);
 background:linear-gradient(#ff2bd6 2px,transparent 2px) 0 0/100% 46px,linear-gradient(90deg,#ff2bd655 2px,transparent 2px) 0 0/46px 100%;
 opacity:.12;animation:lriGrid 6s linear infinite}
@keyframes lriGrid{to{background-position:0 46px,0 0}}
#lr-idle .drift{position:absolute;inset:7vh 7vw;animation:lriDrift 420s ease-in-out infinite alternate}
@keyframes lriDrift{0%{transform:translate(-2.5vw,-2vh)}25%{transform:translate(2vw,1.5vh)}50%{transform:translate(-1vw,2.5vh)}
 75%{transform:translate(2.5vw,-1.5vh)}100%{transform:translate(-2vw,1vh)}}
#lr-idle .wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:space-between;gap:4vw}
#lr-idle.l1 .wrap{flex-direction:row-reverse}
#lr-idle.l2 .wrap{flex-direction:column;justify-content:center}
#lr-idle .clock{white-space:nowrap;font-size:18vh;font-weight:900;letter-spacing:.04em;line-height:1;text-shadow:0 0 8px #fff,0 0 30px #0ff,0 0 70px #08f;opacity:.85}
#lr-idle .clock small{font-size:.32em;letter-spacing:.1em;margin-left:.2em}
#lr-idle .date{font-size:3.6vh;letter-spacing:.35em;color:#ff9ef5;text-shadow:0 0 14px #f0f;margin-top:1vh;opacity:.8}
#lr-idle .np{display:flex;align-items:center;gap:2.4vw;max-width:48vw;padding:2.4vh 2vw;border-radius:14px;
 background:rgba(8,4,30,.65);border:1px solid #ff2bd655;box-shadow:0 0 40px rgba(255,43,214,.18);opacity:.85}
#lr-idle .np img{width:22vh;height:22vh;border-radius:8px;object-fit:cover;background:#111}
#lr-idle .np .k{font-size:2.2vh;letter-spacing:.3em;color:#0ff;opacity:.8}
#lr-idle .np .t{font-size:3.8vh;font-weight:bold;margin:1vh 0;color:#fff}
#lr-idle .np .a{font-size:3vh;color:#ffdd88}
#lr-idle .logo{font-size:6vh;font-weight:900;letter-spacing:.1em;text-shadow:0 0 20px #0ff;opacity:.6}
#lr-idle .hint{position:absolute;bottom:0;width:100%;text-align:center;font-size:2.2vh;letter-spacing:.3em;color:#556;opacity:.8}
@media (prefers-reduced-motion:reduce){#lr-idle .grid{animation:none}}
`;

interface Now { title: string; artist: string; coverUrl: string }

export function initIdle(game: Phaser.Game): { dismiss(): boolean; show(): void } {
  let last = Date.now(), el: HTMLDivElement | null = null, prevMode: string | null = null;
  let layout = 0, relayT = 0, npT = 0;
  const bump = () => { last = Date.now(); };

  const eligible = (): boolean => {
    const sm = game.scene;
    if (sm.isActive('MenuScene')) return true;
    if (sm.isActive('GameScene')) { const g = sm.getScene('GameScene') as any; return !!(g.paused || g.gameOver); }
    return false;
  };

  const onKey = (e: Event) => {
    bump();
    if (el) { e.stopImmediatePropagation(); e.preventDefault(); dismiss(); }
  };
  addEventListener('keydown', onKey, true);
  addEventListener('pointerdown', onKey, true);
  addEventListener('pointermove', bump, { passive: true });
  addEventListener('wheel', bump, { passive: true });
  game.events.on('tvpairing', bump);

  const tick = () => {
    const im = getInput();
    if (el) im.update(); // the game loop sleeps while idle; poll gamepads / phone pads ourselves
    for (const p of [0, 1]) { const a = im.get(p); if (ACTIONS.some(k => a[k])) { bump(); if (el) { im.swallow(); dismiss(); } } }
    const mins = Settings.idleMinutes;
    if (!el && mins > 0 && !document.hidden && eligible() && Date.now() - last > mins * 60_000) show();
  };
  setInterval(tick, 250);

  function show(): void {
    if (el) return;
    if (!document.getElementById('lr-idle-css')) {
      const st = document.createElement('style'); st.id = 'lr-idle-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    el = document.createElement('div');
    el.id = 'lr-idle';
    el.innerHTML = `<div class="sky"></div><div class="grid"></div><div class="drift"><div class="wrap">
      <div><div class="clock"></div><div class="date"></div></div><div class="np"></div></div>
      <div class="hint">PRESS ANY BUTTON</div></div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el?.classList.add('on'));
    document.body.classList.add('lr-idle-on');
    const sm = getSoundManager();
    if (Settings.idleRadio && sm.getMusicMode() !== 'radio') { prevMode = sm.getMusicMode(); sm.setMusicMode('radio'); }
    game.loop.sleep();
    clock(); np();
    relayT = window.setInterval(() => { layout = (layout + 1) % 3; if (el) el.className = `on l${layout}`; }, 180_000);
    npT = window.setInterval(() => { clock(); if (Date.now() % 15000 < 1000) np(); }, 1000);
    (game.registry.get('tvPairing') as any)?.send?.(0, { t: 'state', screen: 'idle' });
  }

  function dismiss(): boolean {
    if (!el) return false;
    const e = el; el = null;
    e.classList.remove('on');
    document.body.classList.remove('lr-idle-on');
    setTimeout(() => e.remove(), 400);
    clearInterval(relayT); clearInterval(npT);
    if (prevMode) { getSoundManager().setMusicMode(prevMode as any); prevMode = null; }
    // after the waking key event has reached the InputManager: absorb it so it doesn't also act on the menu/game
    setTimeout(() => { const im = getInput(); im.update(); im.swallow(); game.loop.wake(); }, 0);
    bump();
    // restore the pads' screen state (whatever the scene last sent)
    const tv = game.registry.get('tvPairing') as any;
    if (tv?.lastState) tv.sendState(tv.lastState);
    return true;
  }

  function clock(): void {
    if (!el) return;
    const d = new Date();
    const [hm, ap] = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).split(/\s(?=[^\d\s:.]+$)/);
    el.querySelector('.clock')!.innerHTML = `${hm}${ap ? `<small>${ap}</small>` : ''}`;
    el.querySelector('.date')!.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
  }

  async function np(): Promise<void> {
    const sm = getSoundManager();
    let n: Now | null = sm.nowPlaying();
    if (!n && sm.getMusicMode() === 'radio') {
      try { n = await (await fetch('/api/radio/now')).json(); } catch { n = null; }
    }
    const box = el?.querySelector('.np') as HTMLElement | null;
    if (!box) return;
    const esc = (t: string) => String(t ?? '').replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);
    box.innerHTML = n && n.title
      ? `${n.coverUrl ? `<img alt="" src="${esc(n.coverUrl)}">` : ''}<div><div class="k">♪ RADIO PARADISE</div><div class="t">${esc(n.title)}</div><div class="a">${esc(n.artist)}</div></div>`
      : `<div class="logo">LODE RUNNER<br>2099</div>`;
  }

  return { dismiss, show };
}
