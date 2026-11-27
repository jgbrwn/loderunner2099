import { describe, it, expect } from 'vitest';
import { InputManager } from './InputManager';

class FakeWin extends EventTarget {}
if (typeof globalThis.KeyboardEvent === 'undefined') {
  (globalThis as any).KeyboardEvent = class extends Event {
    code: string; key: string; keyCode: number; which: number;
    constructor(type: string, init: { code?: string; key?: string; keyCode?: number; which?: number } = {}) {
      super(type); this.code = init.code ?? ''; this.key = init.key ?? ''; this.keyCode = init.keyCode ?? 0; this.which = init.which ?? 0;
    }
  };
}
const key = (t: EventTarget, type: string, code: string) => {
  const e = new Event(type) as any; e.code = code; e.key = code; e.preventDefault = () => {}; t.dispatchEvent(e);
};

describe('InputManager', () => {
  it('injects remote keyboard events into the native DOM/Phaser path', () => {
    const w = new FakeWin();
    const im = new InputManager(w as unknown as Window);
    let event: any = null;
    w.addEventListener('keydown', e => { event = e; });
    w.addEventListener('keyup', e => { event = e; });
    im.keyboard!.remoteKey('KeyT', 't', true);
    expect(event?.type).toBe('keydown');
    expect(event?.code).toBe('KeyT');
    expect(event?.key).toBe('t');
    expect(event?.keyCode).toBe(84);
    im.update();
    expect(im.justPressed(0, 'left')).toBe(false);
    im.keyboard!.remoteKey('bad code!', 'x', true);
    expect(event?.code).toBe('KeyT');
    im.keyboard!.remoteKey('Equal', '+', true);
    expect(event?.keyCode).toBe(187);
    im.keyboard!.remoteKey('NumpadAdd', '+', false);
    expect(event?.keyCode).toBe(107);
    im.keyboard!.remoteKey('ArrowRight', 'ArrowRight', true); // movement stays on normal pad bits
    expect(event?.keyCode).toBe(107);
  });
  it('maps two keyboard sets, remote pads and edges', () => {
    const w = new FakeWin();
    const im = new InputManager(w as unknown as Window);
    im.setTwoPlayerKeys(true);
    key(w, 'keydown', 'KeyA'); key(w, 'keydown', 'ArrowRight');
    im.update();
    expect(im.get(0).left).toBe(true);
    expect(im.get(1).right).toBe(true);
    expect(im.justPressed(0, 'left')).toBe(true);
    im.update();
    expect(im.justPressed(0, 'left')).toBe(false);
    im.remote.feedMessage({ p: 1, a: { digLeft: true } });
    im.update();
    expect(im.get(1).digLeft).toBe(true);
    key(w, 'keyup', 'KeyA');
    im.keyboard!.letters = false;
    key(w, 'keydown', 'KeyD');
    im.update();
    expect(im.get(0).left || im.get(0).right).toBe(false);
  });
  it('numpad: 8/2/4/6 move, 7/9 dig (original PC layout), NumLock on or off', () => {
    const w = new FakeWin();
    const im = new InputManager(w as unknown as Window);
    const press = (code: string, keyName = code) => { const e = new Event('keydown') as any; e.code = code; e.key = keyName; e.preventDefault = () => {}; w.dispatchEvent(e); };
    const release = (code: string, keyName = code) => { const e = new Event('keyup') as any; e.code = code; e.key = keyName; w.dispatchEvent(e); };
    const cases: [string, string, string][] = [['Numpad8', '8', 'up'], ['Numpad2', '2', 'down'], ['Numpad4', '4', 'left'],
      ['Numpad6', '6', 'right'], ['Numpad7', '7', 'digLeft'], ['Numpad9', '9', 'digRight'],
      ['Numpad7', 'Home', 'digLeft'], ['Numpad9', 'PageUp', 'digRight'], ['Numpad4', 'ArrowLeft', 'left']]; // NumLock off
    for (const [code, k, action] of cases) {
      press(code, k); im.update();
      expect((im.get(0) as any)[action], `${code}/${k}`).toBe(true);
      release(code, k); im.update(); im.update();
      expect((im.get(0) as any)[action]).toBe(false);
    }
    im.keyboard!.letters = false; // typing in a text field never blocks the numpad
    press('Numpad7'); im.update(); expect(im.get(0).digLeft).toBe(true); release('Numpad7');
    // shared keyboard 2P: numpad belongs to P2 (the arrow-key side); WASD stays P1 only
    im.setTwoPlayerKeys(true); im.update(); im.update();
    press('Numpad9'); im.update();
    expect(im.get(1).digRight).toBe(true); expect(im.get(0).digRight).toBe(false);
    release('Numpad9');
  });
  it('Android TV couch 2P: every keyboard key set is P1 only; the native controller (remote feed) is P2', () => {
    const w = new FakeWin();
    const im = new InputManager(w as unknown as Window);
    im.setTVRemoteP1();
    for (const code of ['KeyA', 'ArrowLeft', 'Numpad4']) { key(w, 'keydown', code); im.update(); expect(im.get(0).left).toBe(true); expect(im.get(1).left).toBe(false); key(w, 'keyup', code); im.update(); }
    for (const code of ['KeyZ', 'Numpad7']) { key(w, 'keydown', code); im.update(); expect(im.get(0).digLeft).toBe(true); expect(im.get(1).digLeft).toBe(false); key(w, 'keyup', code); im.update(); }
    im.remote.feedMessage({ p: 1, action: 'right', down: true }); im.update();
    expect(im.get(1).right).toBe(true); expect(im.get(0).right).toBe(false);
  });
});
