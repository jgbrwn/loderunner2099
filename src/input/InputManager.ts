// Unified input: keyboard (2 key sets), Gamepad API, touch, TV remote keys, remote phone pads.
// A single global instance owns all window listeners, so scenes never leak them.
export interface InputActions {
  left: boolean; right: boolean; up: boolean; down: boolean;
  digLeft: boolean; digRight: boolean;
  pause: boolean; back: boolean; confirm: boolean;
}
export type Action = keyof InputActions;
export const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'digLeft', 'digRight', 'pause', 'back', 'confirm'];
export const emptyActions = (): InputActions =>
  ({ left: false, right: false, up: false, down: false, digLeft: false, digRight: false, pause: false, back: false, confirm: false });

export interface InputSource {
  /** OR this source's state for `player` into out. */
  poll(player: number, out: InputActions): void;
  destroy?(): void;
}

/** Key bindings by KeyboardEvent.code or .key. Rebindable via setBindings(). */
export type KeyBindings = Record<Action, string[]>;
const SYSTEM: Pick<KeyBindings, 'pause' | 'back' | 'confirm'> = {
  pause: ['KeyP', 'Pause', 'MediaPlayPause', 'MediaPlay', 'MediaPause'],
  back: ['Escape', 'Backspace', 'GoBack', 'BrowserBack'],
  confirm: ['Enter', 'NumpadEnter', 'Space'],
};
export const DEFAULT_BINDINGS: KeyBindings[] = [
  { // P1: arrows + WASD, dig Z/X or Q/E; TV remote media keys dig
    left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
    digLeft: ['KeyZ', 'KeyQ', 'MediaRewind', 'MediaTrackPrevious', 'ChannelUp'],
    digRight: ['KeyX', 'KeyE', 'MediaFastForward', 'MediaTrackNext', 'ChannelDown'], ...SYSTEM,
  },
  { // P2: IJKL, dig U/O
    left: ['KeyJ'], right: ['KeyL'], up: ['KeyI'], down: ['KeyK'], digLeft: ['KeyU'], digRight: ['KeyO'],
    pause: [], back: [], confirm: [],
  },
];
/** In 2-player mode P1 gives the arrows to nobody else; P2 also gets arrows + , . when P1 uses WASD. */
export const TWO_PLAYER_BINDINGS: KeyBindings[] = [
  { left: ['KeyA'], right: ['KeyD'], up: ['KeyW'], down: ['KeyS'], digLeft: ['KeyQ', 'KeyZ'], digRight: ['KeyE', 'KeyX'], ...SYSTEM },
  { left: ['ArrowLeft', 'KeyJ'], right: ['ArrowRight', 'KeyL'], up: ['ArrowUp', 'KeyI'], down: ['ArrowDown', 'KeyK'],
    digLeft: ['Comma', 'KeyU'], digRight: ['Period', 'KeyO'], pause: [], back: [], confirm: [] },
];

export class KeyboardSource implements InputSource {
  private down = new Set<string>();
  private bound = new Set<string>();
  /** keys pressed since the last frame: a tap shorter than one frame still registers */
  private tapped = new Set<string>();
  /** When false, letter keys (KeyA..KeyZ) are ignored, e.g. while a seed text field is focused in a menu. */
  letters = true;
  constructor(private target: Window, public bindings: KeyBindings[] = DEFAULT_BINDINGS) {
    this.rebuild();
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }
  setBindings(b: KeyBindings[]): void { this.bindings = b; this.rebuild(); }
  private rebuild() { this.bound = new Set(this.bindings.flatMap(b => Object.values(b).flat())); }
  private onDown = (e: KeyboardEvent) => {
    this.down.add(e.code); this.down.add(e.key); this.tapped.add(e.code); this.tapped.add(e.key);
    if ((this.bound.has(e.code) || this.bound.has(e.key)) && e.code !== 'Escape' && (e.target as HTMLElement | null)?.tagName !== 'INPUT') e.preventDefault();
  };
  /** A remote keyboard is injected into the TV's native event path. Phaser 4 still reads the
   * legacy numeric keyCode for its Key objects, while our InputManager reads code/key. Supply both. */
  remoteKey(code: string, key: string, down: boolean): void {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(code) || key.length > 40) return;
    let keyCode = 0;
    if (/^Key[A-Z]$/.test(code)) keyCode = code.charCodeAt(3);
    else if (code === 'Equal') keyCode = 187;
    else if (code === 'Minus') keyCode = 189;
    else if (code === 'NumpadAdd') keyCode = 107;
    else if (code === 'NumpadSubtract') keyCode = 109;
    if (!keyCode) return; // only forwarded game shortcuts reach this path
    this.target.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, keyCode, which: keyCode, bubbles: true }));
  }
  private onUp = (e: KeyboardEvent) => { this.down.delete(e.code); this.down.delete(e.key); };
  private onBlur = () => this.down.clear();
  endFrame(): void { this.tapped.clear(); }
  isDown(code: string): boolean { return this.down.has(code); }
  poll(player: number, out: InputActions): void {
    const b = this.bindings[player];
    if (!b) return;
    for (const a of ACTIONS) {
      if (!out[a] && b[a].some(k => (this.down.has(k) || this.tapped.has(k)) && (this.letters || !k.startsWith('Key')))) out[a] = true;
    }
  }
  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}

/** Standard-mapping gamepads; connected pads are assigned to players in index order. */
export class GamepadSource implements InputSource {
  deadzone = 0.5;
  poll(player: number, out: InputActions): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p && p.connected);
    const p = pads[player];
    if (!p) return;
    const b = (i: number) => !!p.buttons[i]?.pressed;
    const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
    out.left ||= b(14) || ax < -this.deadzone;
    out.right ||= b(15) || ax > this.deadzone;
    out.up ||= b(12) || ay < -this.deadzone;
    out.down ||= b(13) || ay > this.deadzone;
    out.digLeft ||= b(2) || b(4) || b(6);
    out.digRight ||= b(1) || b(5) || b(7);
    out.confirm ||= b(0);
    out.pause ||= b(9);
    out.back ||= b(8);
  }
}

/** Generic state source, e.g. on-screen touch controls (player 0). */
export class StateSource implements InputSource {
  constructor(public player: number, public read: () => Partial<InputActions>) {}
  poll(player: number, out: InputActions): void {
    if (player !== this.player) return;
    const s = this.read();
    for (const a of ACTIONS) if (s[a]) out[a] = true;
  }
}

/** Phone controllers over WebSocket. Feed it decoded messages; it keeps the latest state per player. */
export class RemotePadSource implements InputSource {
  private state = new Map<number, InputActions>();
  /** Set full or partial action state for a player. */
  feed(player: number, actions: Partial<InputActions>): void {
    const s = this.state.get(player) ?? emptyActions();
    for (const a of ACTIONS) if (a in actions) s[a] = !!actions[a];
    this.state.set(player, s);
  }
  /** Accepts {p, a:{...}} or {player, actions:{...}} or {p, action, down}. Returns false if unrecognised. */
  feedMessage(msg: unknown): boolean {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, any>;
    const player = Number(m.p ?? m.player ?? 0) | 0;
    if (m.a || m.actions) { this.feed(player, m.a ?? m.actions); return true; }
    if (typeof m.action === 'string' && (ACTIONS as string[]).includes(m.action)) { this.feed(player, { [m.action]: !!m.down }); return true; }
    return false;
  }
  disconnect(player: number): void { this.state.delete(player); }
  poll(player: number, out: InputActions): void {
    const s = this.state.get(player);
    if (s) for (const a of ACTIONS) if (s[a]) out[a] = true;
  }
}

export class InputManager {
  readonly keyboard: KeyboardSource | null;
  readonly gamepad = new GamepadSource();
  readonly remote = new RemotePadSource();
  private extra: InputSource[] = [];
  private cur: InputActions[] = [emptyActions(), emptyActions()];
  private prev: InputActions[] = [emptyActions(), emptyActions()];

  constructor(target: Window | null = typeof window !== 'undefined' ? window : null) {
    this.keyboard = target ? new KeyboardSource(target) : null;
  }
  addSource(s: InputSource): () => void {
    this.extra.push(s);
    return () => { this.extra = this.extra.filter(x => x !== s); };
  }
  setTwoPlayerKeys(on: boolean): void { this.keyboard?.setBindings(on ? TWO_PLAYER_BINDINGS : DEFAULT_BINDINGS); }
  /** Android TV: remote (arrows) drives P1, BT controller (native) drives P2. */
  setTVRemoteP1(): void {
    const p1: KeyBindings = { ...DEFAULT_BINDINGS[0] };           // arrows + media keys
    const p2: KeyBindings = { ...TWO_PLAYER_BINDINGS[0], pause: [], back: [], confirm: [] }; // WASD unused on TV
    this.keyboard?.setBindings([p1, p2]);
  }
  /** Call once per frame before reading. */
  update(): void {
    for (let p = 0; p < this.cur.length; p++) {
      this.prev[p] = this.cur[p];
      const out = emptyActions();
      this.keyboard?.poll(p, out);
      this.gamepad.poll(p, out);
      this.remote.poll(p, out);
      for (const s of this.extra) s.poll(p, out);
      this.cur[p] = out;
    }
    this.keyboard?.endFrame();
  }
  get(player: number): InputActions { return this.cur[player] ?? emptyActions(); }
  justPressed(player: number, a: Action): boolean { return !!this.cur[player]?.[a] && !this.prev[player]?.[a]; }
  /** Any player pressed (menus). */
  anyJustPressed(a: Action): boolean { return this.cur.some((_, p) => this.justPressed(p, a)); }
  /** Clear edge state (e.g. on scene change, so a held key doesn't re-trigger). */
  swallow(): void { this.prev = this.cur.map(c => ({ ...c })); }
}

let instance: InputManager | null = null;
export function getInput(): InputManager { return (instance ??= new InputManager()); }
