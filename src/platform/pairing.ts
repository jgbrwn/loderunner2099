// TV-side pairing client (protocol: docs/overhaul/PROTOCOL.md). Usage:
//   const tv = new TVPairing();                 // connects /ws/tv (same code across restarts: code+token in localStorage)
//   tv.onChange = () => draw(tv.code, tv.pads, tv.connected);   // pads: [{slot, name, player}]
//   <img src={tv.qrImageUrl()}>  /  tv.padUrl()  // what phones should open
//   tv.sendState({ screen: 'play', mode: 'single', level: 3, lives: 4, score: 0, gold: [0, 9] });
//   tv.rumble(0, 80); tv.event('gold'); tv.onMenu = (player, action) => ...; tv.close();
// Phone slot 1 → player 0, slot 2 → player 1 (override slotToPlayer); spectators (3+) are ignored.
// Button bits are fed into getInput().remote (RemotePadSource), so scenes just read getInput() as usual.
import { getInput, type RemotePadSource } from '../input/InputManager';
import { bitsToActions } from './padBits';

export interface RemoteKey { code: string; key: string; down: boolean }
export interface PadInfo { slot: number; name: string; player: number | null }
export interface TVState {
  screen: 'menu' | 'play' | 'pause' | 'over' | 'idle'; mode?: 'single' | 'coop' | 'versus';
  level?: number; lives?: number; score?: number; gold?: [number, number];
}
export interface PairingOptions {
  url?: string;                          // default: same-origin /ws/tv
  input?: RemotePadSource;               // default: getInput().remote
  WebSocketImpl?: typeof WebSocket;      // for tests
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  slotToPlayer?: (slot: number) => number | null;
}

const MIN_HOLD_MS = 50;     // a tap shorter than this is stretched so a game frame sees it
const STALE_MS = 3500;      // phones send state every 1 s; release everything if silent this long
const KEY = 'lr2099.tvcode';
const TOKEN_KEY = 'lr2099.tvtoken';
const newToken = (): string => {
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};

export class TVPairing {
  code = '';
  connected = false;
  pads: PadInfo[] = [];
  onChange: () => void = () => {};
  onMenu: (player: number | null, action: string, slot: number) => void = () => {};
  /** Any other app message from a phone. */
  onPadMessage: (slot: number, m: any) => void = () => {};
  /** Keyboard events forwarded by a /pad keyboard. No keyboard location is inferred. */
  onRemoteKey: (slot: number, event: RemoteKey) => void = () => {};

  private ws: WebSocket | null = null;
  private token = '';
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private staleIv: ReturnType<typeof setInterval>;
  private lastState: TVState | null = null;
  private bits = new Map<number, { cur: number; eff: number; at: number[]; seen: number }>();
  private input: RemotePadSource;
  private WS: typeof WebSocket;
  private storage: PairingOptions['storage'];
  slotToPlayer: (slot: number) => number | null;

  constructor(private opts: PairingOptions = {}) {
    this.input = opts.input ?? getInput().remote;
    this.WS = opts.WebSocketImpl ?? WebSocket;
    this.storage = opts.storage !== undefined ? opts.storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    this.slotToPlayer = opts.slotToPlayer ?? (s => (s === 1 ? 0 : s === 2 ? 1 : null));
    this.token = this.storage?.getItem(TOKEN_KEY) || '';
    if (!this.token) { this.token = newToken(); this.storage?.setItem(TOKEN_KEY, this.token); }
    this.staleIv = setInterval(() => this.checkStale(), 1000);
    this.connect();
  }

  padUrl(): string { return `${location.origin}/pad?code=${this.code}`; }
  qrImageUrl(): string { return `/api/qr?text=${encodeURIComponent(this.padUrl())}`; }

  /** Relay an app message to a phone slot (0 = all). */
  send(slot: number, m: object): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ to: slot, m }));
  }
  sendState(s: TVState): void { this.lastState = s; this.send(0, { t: 'state', ...s }); }
  rumble(player: number, ms: number): void { const sl = this.slotOf(player); if (sl) this.send(sl, { t: 'rumble', ms }); }
  event(e: 'gold' | 'death' | 'clear' | 'trap', player?: number): void {
    const sl = player === undefined ? 0 : this.slotOf(player);
    if (sl !== null) this.send(sl, { t: 'event', e });
  }
  kick(slot: number): void { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'kick', to: slot })); }
  /** Disconnect every phone (they won't auto-rejoin until the user taps Rejoin). */
  kickAll(): void { for (const p of this.pads) this.kick(p.slot); }
  /** Drop all phones and get a fresh code (new token, so the old code is released). */
  newCode(): void {
    this.kickAll();
    this.token = newToken();
    this.storage?.setItem(TOKEN_KEY, this.token);
    this.storage?.setItem(KEY, '');
    this.code = '';
    const old = this.ws;
    this.ws = null;
    old?.close();
    for (const p of this.pads) this.release(p.slot);
    this.pads = [];
    this.connected = false;
    this.onChange();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), 150);
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    clearInterval(this.staleIv);
    this.ws?.close();
    for (const p of this.pads) this.release(p.slot);
  }

  private slotOf(player: number): number | null { return this.pads.find(p => p.player === player)?.slot ?? null; }

  private connect(): void {
    if (this.closed) return;
    let url = this.opts.url;
    if (!url) url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/tv`;
    const prev = this.code || this.storage?.getItem(KEY) || '';
    if (prev) url += (url.includes('?') ? '&' : '?') + 'code=' + encodeURIComponent(prev);
    url += (url.includes('?') ? '&' : '?') + 'token=' + this.token;
    const ws = new this.WS(url);
    this.ws = ws;
    ws.onmessage = ev => { try { this.handle(JSON.parse(String(ev.data))); } catch { /* bad frame */ } };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      for (const p of this.pads) this.release(p.slot);
      this.onChange();
      if (this.closed) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  private handle(msg: any): void {
    switch (msg.t) {
      case 'room':
        this.code = String(msg.code);
        this.storage?.setItem(KEY, this.code);
        this.connected = true;
        this.retry = 0;
        this.pads = (msg.pads ?? []).map((p: any) => this.info(p.slot, p.name));
        if (this.lastState) this.sendState(this.lastState);
        break;
      case 'join':
        this.pads = this.pads.filter(p => p.slot !== msg.slot).concat(this.info(msg.slot, msg.name)).sort((a, b) => a.slot - b.slot);
        if (this.lastState) this.send(msg.slot, { t: 'state', ...this.lastState });
        break;
      case 'leave':
        this.release(msg.slot);
        this.pads = this.pads.filter(p => p.slot !== msg.slot);
        break;
      case 'pad': this.padMsg(Number(msg.slot), msg.m ?? {}); return;
      default: return;
    }
    this.onChange();
  }

  private info(slot: number, name?: string): PadInfo {
    return { slot, name: name || `Phone ${slot}`, player: this.slotToPlayer(slot) };
  }

  private padMsg(slot: number, m: any): void {
    const player = this.slotToPlayer(slot);
    if (m.t === 'in') {
      if (player === null) return;
      this.applyBits(slot, player, Number(m.b) | 0);
    } else if (m.t === 'menu') this.onMenu(player, String(m.a), slot);
    else if (m.t === 'key' && typeof m.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(m.code) && typeof m.key === 'string' && m.key.length <= 40) {
      this.onRemoteKey(slot, { code: m.code, key: m.key, down: m.down === true });
    } else this.onPadMessage(slot, m);
  }

  private applyBits(slot: number, player: number, b: number): void {
    const now = Date.now();
    const s = this.bits.get(slot) ?? { cur: 0, eff: 0, at: [], seen: now };
    s.seen = now;
    const pressed = b & ~s.cur, released = s.cur & ~b;
    s.cur = b;
    for (let i = 0; i < 9; i++) if (pressed & (1 << i)) s.at[i] = now;
    s.eff |= pressed;
    for (let i = 0; i < 9; i++) {
      const bit = 1 << i;
      if (!(released & bit)) continue;
      const left = MIN_HOLD_MS - (now - (s.at[i] ?? 0));
      if (left <= 0) s.eff &= ~bit;
      else setTimeout(() => {
        const t = this.bits.get(slot);
        if (t && !(t.cur & bit)) { t.eff &= ~bit; this.input.feed(player, bitsToActions(t.eff)); }
      }, left);
    }
    this.bits.set(slot, s);
    this.input.feed(player, bitsToActions(s.eff));
  }

  private release(slot: number): void {
    const s = this.bits.get(slot);
    this.bits.delete(slot);
    const player = this.slotToPlayer(slot);
    if (s && player !== null) this.input.disconnect(player);
  }

  private checkStale(): void {
    const now = Date.now();
    for (const [slot, s] of this.bits) if (s.cur && now - s.seen > STALE_MS) this.release(slot);
  }
}
