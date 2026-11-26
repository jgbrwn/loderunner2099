// Anonymous owner-only presence: a random sessionStorage id, coarse game state and idle age.
// No account, player name, seed, or IP is sent by the client. Heartbeats are tiny and deduplicated.
import type Phaser from 'phaser';
import { getInput, ACTIONS } from '../input/InputManager';

type Screen = 'menu' | 'play' | 'pause' | 'over' | 'idle' | 'hidden';
interface Snapshot { id: string; kind: 'web' | 'tv'; screen: Screen; mode?: string; level?: number; players: number; room?: string; idleMs: number }

const ID_KEY = 'lr2099.presence';
const randomId = (): string => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, n => n.toString(36).padStart(2, '0')).join('').slice(0, 24);
};

export function initPresence(game: Phaser.Game): void {
  let id = '';
  try { id = sessionStorage.getItem(ID_KEY) || ''; if (!id) { id = randomId(); sessionStorage.setItem(ID_KEY, id); } }
  catch { id = randomId(); } // privacy mode: still anonymous; a reload simply looks like a new visit
  let lastInput = Date.now();
  const bump = () => { lastInput = Date.now(); };
  for (const e of ['pointerdown', 'pointermove', 'keydown', 'wheel']) addEventListener(e, bump, { passive: true, capture: true });
  let gamepadButtons = '';
  const snapshot = (): Snapshot => {
    let screen: Screen = 'menu', mode: string | undefined, level: number | undefined, players = 1;
    if (document.getElementById('lr-idle')) screen = 'idle';
    else if (game.scene.isActive('GameScene')) {
      const g = game.scene.getScene('GameScene') as any;
      screen = g.gameOver ? 'over' : g.paused ? 'pause' : 'play';
      mode = g.mode; level = g.level; players = g.numPlayers;
    }
    if (document.hidden) screen = 'hidden';
    const im = getInput();
    // Keyboard/touch events above plus gamepad/pad state cover non-DOM controls. The periodic
    // sample is intentionally only for activity, never for controlling or inspecting the game.
    for (let p = 0; p < 2; p++) {
      const a = im.get(p);
      if (ACTIONS.some(k => a[k])) bump();
    }
    try {
      const pads = Array.from(navigator.getGamepads?.() ?? []).filter(Boolean);
      const state = pads.map(p => p!.buttons.map(b => b.pressed ? 1 : 0).join('') + ':' + p!.axes.map(n => Math.abs(n) > .5 ? Math.sign(n) : 0).join(',')).join('|');
      if (state !== gamepadButtons) { if (gamepadButtons || /1|:-?[1-9]/.test(state)) bump(); gamepadButtons = state; }
    } catch { /* no gamepad API */ }
    const tv = game.registry.get('tvPairing') as any;
    return { id, kind: tv ? 'tv' : 'web', screen, mode, level, players, room: tv?.code || undefined, idleMs: Math.max(0, Date.now() - lastInput) };
  };
  let previous = JSON.stringify({ ...snapshot(), idleMs: 0 }), lastSent = 0;
  const send = (gone = false): void => {
    const s = snapshot();
    const now = Date.now();
    // At least one heartbeat per TTL; otherwise only meaningful changes trigger a request.
    // idleMs changes continuously, so exclude it from the change key and report it at heartbeat time.
    if (!gone && now - lastSent < 15_000) {
      const key = JSON.stringify({ ...s, idleMs: Math.floor(s.idleMs / 30_000) });
      if (key === previous) return;
      previous = key;
    }
    lastSent = now;
    const body = JSON.stringify({ ...s, gone });
    if (gone && navigator.sendBeacon) { navigator.sendBeacon('/api/presence', new Blob([body], { type: 'application/json' })); return; }
    void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  send();
  setInterval(send, 15_000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { void fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snapshot(), gone: true }), keepalive: true }).catch(() => {}); } else send(false); });
  addEventListener('pagehide', () => send(true));
}
