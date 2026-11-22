import { describe, it, expect, vi } from 'vitest';
import { TVPairing } from './pairing';
import { RemotePadSource, emptyActions } from '../input/InputManager';

class FakeWS {
  static last: FakeWS;
  readyState = 1; sent: any[] = [];
  onmessage: ((e: { data: string }) => void) | null = null; onclose: (() => void) | null = null;
  constructor(public url: string) { FakeWS.last = this; }
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close() { this.onclose?.(); }
  recv(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const poll = (src: RemotePadSource, p: number) => { const o = emptyActions(); src.poll(p, o); return o; };

describe('TVPairing', () => {
  it('maps pad bits to players, stretches short taps, relays state and reconnects with the code', () => {
    vi.useFakeTimers();
    const input = new RemotePadSource();
    const tv = new TVPairing({ url: 'ws://x/ws/tv', input, WebSocketImpl: FakeWS as any, storage: null });
    const ws = FakeWS.last;
    ws.recv({ t: 'room', code: 'ABCD', pads: [] });
    expect(tv.code).toBe('ABCD');
    ws.recv({ t: 'join', slot: 2, name: 'Bo' });
    expect(tv.pads).toEqual([{ slot: 2, name: 'Bo', player: 1 }]);
    ws.recv({ t: 'pad', slot: 2, m: { t: 'in', b: 1 | 32 } });
    expect(poll(input, 1)).toMatchObject({ left: true, digRight: true, right: false });
    expect(poll(input, 0).left).toBe(false);
    ws.recv({ t: 'pad', slot: 2, m: { t: 'in', b: 0 } }); // released within MIN_HOLD: still held
    expect(poll(input, 1).left).toBe(true);
    vi.advanceTimersByTime(60);
    expect(poll(input, 1).left).toBe(false);
    tv.sendState({ screen: 'play', level: 2 });
    expect(ws.sent[ws.sent.length - 1]).toEqual({ to: 0, m: { t: 'state', screen: 'play', level: 2 } });
    tv.rumble(1, 80);
    expect(ws.sent[ws.sent.length - 1]).toEqual({ to: 2, m: { t: 'rumble', ms: 80 } });
    ws.recv({ t: 'pad', slot: 2, m: { t: 'in', b: 4 } });
    ws.close();
    expect(poll(input, 1).up).toBe(false); // released on disconnect
    vi.advanceTimersByTime(600);
    expect(FakeWS.last).not.toBe(ws);
    expect(FakeWS.last.url).toBe('ws://x/ws/tv?code=ABCD');
    tv.close();
    vi.useRealTimers();
  });
});
