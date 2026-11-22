// Phone controller page (/pad?code=ABCD). Protocol: docs/overhaul/PROTOCOL.md.
import './pad.css';
import { makeDpad, makeButton, vibrate, DPAD_SVG, WIDGET_CSS, type Dir } from '../ui/dpad';
import { PAD_BITS } from '../platform/padBits';
import { keepAwake } from '../platform/wakeLock';
import { initPWA, isStandalone } from '../platform/pwa';
import { lockGestures } from '../platform/mobile';
import type { Action } from '../input/InputManager';

initPWA();
lockGestures();
const st = document.createElement('style');
st.textContent = WIDGET_CSS;
document.head.appendChild(st);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const COLORS: Record<number, string> = { 1: '#00ff88', 2: '#ffcc00' };
const ALPH = /[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g;
const ls = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ''; localStorage.setItem(k, v); } catch { /* private mode */ } return ''; };
const clientId = ls('lr2099.padId') || (ls('lr2099.padId', Math.random().toString(36).slice(2, 12)), ls('lr2099.padId'));

const q = new URLSearchParams(location.search);
const codeIn = $<HTMLInputElement>('code'), nameIn = $<HTMLInputElement>('name');
codeIn.value = (q.get('code') || q.get('room') || '').toUpperCase().replace(ALPH, '').slice(0, 4);
nameIn.value = ls('lr2099.padName');
codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(ALPH, '').slice(0, 4); });

let ws: WebSocket | null = null;
let code = '', slot = 0, wantSlot = '1', bits = 0, active = false, retry = 0, inPlay = true;
let retryTimer: ReturnType<typeof setTimeout> | undefined, pingAt = 0, rtt = 0;
const lastState: Record<string, any> = {};

$('joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const sub = (e as SubmitEvent).submitter as HTMLElement | null;
  wantSlot = sub?.dataset.slot ?? '1';
  code = codeIn.value;
  if (code.length !== 4) { $('joinMsg').textContent = 'Enter the 4-character code from the TV'; return; }
  ls('lr2099.padName', nameIn.value.trim());
  history.replaceState(null, '', `${location.pathname}?code=${code}`);
  if (!isStandalone()) document.documentElement.requestFullscreen?.().catch(() => {});
  (screen.orientation as any)?.lock?.('landscape').catch?.(() => {});
  start();
});
$('leave').addEventListener('click', () => stop(''));

function start(): void {
  active = true; retry = 0; slot = 0;
  $('join').hidden = true; $('ctl').hidden = false;
  setWho(Number(wantSlot));
  connect();
}
function stop(msg: string): void {
  active = false;
  clearTimeout(retryTimer);
  const w = ws; ws = null; w?.close();
  setBits(0);
  $('join').hidden = false; $('ctl').hidden = true;
  $('joinMsg').textContent = msg;
}

function connect(): void {
  if (!active) return;
  const p = new URLSearchParams({ code, slot: String(slot || wantSlot), id: clientId });
  if (nameIn.value.trim()) p.set('name', nameIn.value.trim().slice(0, 24));
  const w = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/pad?${p}`);
  ws = w;
  conn('connecting…');
  w.onopen = () => { retry = 0; send({ t: 'in', b: bits }); };
  w.onmessage = ev => { try { onMsg(JSON.parse(String(ev.data))); } catch { /* ignore */ } };
  w.onclose = () => {
    if (ws !== w || !active) return;
    ws = null;
    conn('reconnecting…', true);
    retryTimer = setTimeout(connect, Math.min(5000, 300 * 2 ** retry++));
  };
}
const send = (m: object) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };

const ERRORS: Record<string, string> = {
  no_room: 'No TV found with that code', slot_taken: 'That player is already taken', full: 'This TV has too many phones',
};
function onMsg(m: any): void {
  switch (m.t) {
    case 'joined': slot = m.slot; setWho(slot); tvUp(m.tv !== false); break;
    case 'error': stop(ERRORS[m.error] ?? `Error: ${m.error}`); break;
    case 'tv': tvUp(!!m.up); break;
    case 'pong': rtt = Math.round(performance.now() - pingAt); tvUp(!document.body.classList.contains('tvdown')); break;
    case 'slot': slot = m.slot; setWho(slot); break;
    case 'rumble': vibrate(Math.min(1000, Number(m.ms) || 60)); break;
    case 'event':
      vibrate(m.e === 'death' ? [80, 40, 120] as any : m.e === 'clear' ? [40, 30, 40, 30, 120] as any : 30);
      document.body.classList.remove('flash'); void document.body.offsetWidth; document.body.classList.add('flash');
      break;
    case 'state': Object.assign(lastState, m); renderState(); break;
  }
}
function setWho(s: number): void {
  const c = COLORS[s] ?? '#88aaff';
  document.body.style.setProperty('--pc', c);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#05010f');
  $('who').textContent = s >= 3 ? `SPECTATOR ${s}` : `P${s}`;
}
function conn(t: string, bad = false): void { $('conn').textContent = t; document.body.classList.toggle('tvdown', bad); }
function tvUp(up: boolean): void { conn(up ? `● ${code}${rtt ? ` · ${rtt}ms` : ''}` : 'TV offline — waiting…', !up); }

function renderState(): void {
  const s = lastState;
  const play = !s.screen || s.screen === 'play';
  if (play !== inPlay) { setBits(bits & ~(PAD_BITS.digLeft | PAD_BITS.digRight | PAD_BITS.back | PAD_BITS.confirm)); inPlay = play; }
  document.body.classList.toggle('menu', !play);
  actA.textContent = play ? '◀ DIG' : 'BACK';
  actB.textContent = play ? 'DIG ▶' : 'OK';
  const parts: string[] = [];
  if (s.screen && s.screen !== 'play') parts.push(String(s.screen).toUpperCase());
  if (s.level) parts.push(`LEVEL ${s.level}`);
  if (s.lives !== undefined) parts.push(`♥${s.lives}`);
  if (s.gold) parts.push(`◆${s.gold[0]}/${s.gold[1]}`);
  if (s.score !== undefined) parts.push(`${s.score}`);
  $('info').textContent = parts.join('  ');
}

function setBits(b: number): void {
  if (b === bits) return;
  bits = b;
  send({ t: 'in', b });
}
const hold = (a: Action, down: boolean) => setBits(down ? bits | PAD_BITS[a] : bits & ~PAD_BITS[a]);

// widgets
const dp = $('dpad');
dp.className = 'dpad';
dp.innerHTML = DPAD_SVG;
let dir: Dir = null;
makeDpad(dp, d => {
  let b = bits & ~(PAD_BITS.left | PAD_BITS.right | PAD_BITS.up | PAD_BITS.down);
  if (d) b |= PAD_BITS[d];
  dir = d;
  setBits(b);
});
for (const el of Array.from(document.querySelectorAll<HTMLElement>('.sys .tbtn'))) makeButton(el, d => hold(el.dataset.a as Action, d), 20);
const actA = $('actA'), actB = $('actB');
makeButton(actA, d => hold(inPlay ? 'digLeft' : 'back', d));
makeButton(actB, d => hold(inPlay ? 'digRight' : 'confirm', d));
renderState();

setInterval(() => send({ t: 'in', b: bits }), 1000); // keepalive / resync
setInterval(() => { pingAt = performance.now(); send({ t: 'ping' }); }, 3000);
keepAwake(() => active);
addEventListener('blur', () => setBits(0));
document.addEventListener('visibilitychange', () => { if (document.hidden) setBits(0); else if (active && !ws) connect(); });
void dir;

// auto-join when opened from the TV's QR code with a previously used slot
if (codeIn.value.length === 4 && q.get('slot')) { wantSlot = q.get('slot')!; code = codeIn.value; start(); }
