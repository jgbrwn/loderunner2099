// Button bitmask shared by the phone pad and the TV (see docs/overhaul/PROTOCOL.md).
import { ACTIONS, emptyActions, type Action, type InputActions } from '../input/InputManager';

export const PAD_BITS: Record<Action, number> = {
  left: 1, right: 2, up: 4, down: 8, digLeft: 16, digRight: 32, pause: 64, back: 128, confirm: 256,
};
export function bitsToActions(b: number): InputActions {
  const out = emptyActions();
  for (const a of ACTIONS) out[a] = (b & PAD_BITS[a]) !== 0;
  return out;
}
export function actionsToBits(a: Partial<InputActions>): number {
  let b = 0;
  for (const k of ACTIONS) if (a[k]) b |= PAD_BITS[k];
  return b;
}
