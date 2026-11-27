import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Settings } from './Settings';

const storage = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};
vi.stubGlobal('localStorage', localStorage);
beforeEach(() => storage.clear());
const CRT_KEY = 'lr2099.crt';

describe('CRT preference', () => {
  it('defaults to off without a saved preference', () => {
    localStorage.removeItem(CRT_KEY);
    expect(Settings.crt).toBe(false);
  });

  it('remembers an explicit on or off selection', () => {
    Settings.crt = true;
    expect(localStorage.getItem(CRT_KEY)).toBe('1');
    expect(Settings.crt).toBe(true);
    Settings.crt = false;
    expect(localStorage.getItem(CRT_KEY)).toBe('0');
    expect(Settings.crt).toBe(false);
  });

  it('preserves on from the previous default-on version', () => {
    localStorage.setItem(CRT_KEY, '1');
    expect(Settings.crt).toBe(true);
  });
});
