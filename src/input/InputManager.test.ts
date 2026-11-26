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
});
