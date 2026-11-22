// Animated neon boot splash. index.html inlines the same markup so it paints before JS loads;
// other pages (e.g. /tv) call showSplash() early. hideSplash() fades it out (respecting a minimum show time).
export const SPLASH_CSS = `
#lr-splash{position:fixed;inset:0;z-index:100;background:#05010f;display:flex;flex-direction:column;align-items:center;
 justify-content:center;font-family:'Courier New',monospace;transition:opacity .45s;overflow:hidden}
#lr-splash.out{opacity:0;pointer-events:none}
#lr-splash .grid{position:absolute;left:-50%;right:-50%;bottom:-10%;height:55%;transform:perspective(300px) rotateX(60deg);
 background:linear-gradient(#ff2bd6 2px,transparent 2px) 0 0/100% 40px,linear-gradient(90deg,#ff2bd666 2px,transparent 2px) 0 0/40px 100%;
 opacity:.35;animation:lrgrid 1.2s linear infinite}
#lr-splash .t1{font-size:min(11vw,84px);font-weight:900;color:#e0ffff;letter-spacing:.08em;
 text-shadow:0 0 4px #fff,0 0 12px #0ff,0 0 28px #0ff,0 0 56px #08f;animation:lrflick 2.6s infinite}
#lr-splash .t2{font-size:min(8vw,60px);font-weight:900;color:#ffe0fa;letter-spacing:.3em;margin-top:.1em;
 text-shadow:0 0 4px #fff,0 0 12px #f0f,0 0 30px #ff2bd6;animation:lrpulse 1.6s ease-in-out infinite alternate}
#lr-splash .bar{width:min(50vw,320px);height:4px;margin-top:5vh;background:#0ff2;border-radius:2px;overflow:hidden}
#lr-splash .bar i{display:block;height:100%;width:40%;background:#0ff;box-shadow:0 0 10px #0ff;animation:lrload 1s ease-in-out infinite}
@keyframes lrgrid{to{background-position:0 40px,0 0}}
@keyframes lrflick{0%,18%,22%,62%,64%,100%{opacity:1}20%,63%{opacity:.35}}
@keyframes lrpulse{from{opacity:.75}to{opacity:1}}
@keyframes lrload{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){#lr-splash *{animation:none!important}}`;
export const SPLASH_HTML = `<div class="grid"></div><div class="t1">LODE RUNNER</div><div class="t2">2099</div><div class="bar"><i></i></div>`;

const shownAt = typeof performance !== 'undefined' ? performance.now() : 0;

export function showSplash(): HTMLElement {
  let el = document.getElementById('lr-splash');
  if (el) return el;
  const st = document.createElement('style');
  st.textContent = SPLASH_CSS;
  document.head.appendChild(st);
  el = document.createElement('div');
  el.id = 'lr-splash';
  el.innerHTML = SPLASH_HTML;
  document.body.appendChild(el);
  return el;
}

export function hideSplash(minMs = 900): void {
  const el = document.getElementById('lr-splash');
  if (!el) return;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  }, Math.max(0, minMs - (performance.now() - shownAt)));
}
