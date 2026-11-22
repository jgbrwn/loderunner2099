import { describe, it, expect } from 'vitest';
import { InputManager } from './InputManager';

class FakeWin extends EventTarget {}
const key = (t: EventTarget, type: string, code: string) => {
  const e = new Event(type) as any; e.code = code; e.key = code; e.preventDefault = () => {}; t.dispatchEvent(e);
};

describe('InputManager', () => {
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
