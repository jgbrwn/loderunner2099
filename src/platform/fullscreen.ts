// Fullscreen API helper. Unsupported on iPhone Safari (no element fullscreen) and pointless when standalone.
import { isStandalone } from './pwa';

const doc = document as any;
export const fullscreenSupported = (): boolean =>
  !isStandalone() && !!(document.documentElement.requestFullscreen || (document.documentElement as any).webkitRequestFullscreen)
  && (doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false);
export const isFullscreen = (): boolean => !!(doc.fullscreenElement || doc.webkitFullscreenElement);

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as any;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else el.webkitRequestFullscreen?.();
    (screen.orientation as any)?.lock?.('landscape').catch?.(() => {});
    return true;
  } catch { return false; }
}
export async function exitFullscreen(): Promise<void> {
  try { if (doc.exitFullscreen) await doc.exitFullscreen(); else doc.webkitExitFullscreen?.(); } catch { /* ignore */ }
}
export const toggleFullscreen = (): Promise<unknown> => (isFullscreen() ? exitFullscreen() : enterFullscreen());

export function onFullscreenChange(cb: () => void): () => void {
  document.addEventListener('fullscreenchange', cb);
  document.addEventListener('webkitfullscreenchange', cb);
  return () => { document.removeEventListener('fullscreenchange', cb); document.removeEventListener('webkitfullscreenchange', cb); };
}
