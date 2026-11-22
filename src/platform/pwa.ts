/// <reference types="vite/client" />
// PWA glue: service-worker registration + install-prompt hooks for the menu.
//   onInstallAvailable(cb)  -> cb(true) when an install button should be shown (cb(false) after install)
//   promptInstall()         -> shows the native prompt (Chrome/Android) ; resolves 'accepted'|'dismissed'|'unavailable'
//   iosInstallHint()        -> true on iOS Safari (not installed): show "Share → Add to Home Screen" text instead
let deferred: any = null;
const listeners = new Set<(available: boolean) => void>();
const emit = () => listeners.forEach(cb => cb(canInstall()));

export const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as any).standalone === true;
export const canInstall = (): boolean => !!deferred && !isStandalone();
export const iosInstallHint = (): boolean => /iP(hone|ad|od)/.test(navigator.userAgent) && !isStandalone();

export function onInstallAvailable(cb: (available: boolean) => void): () => void {
  listeners.add(cb);
  cb(canInstall());
  return () => listeners.delete(cb);
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const d = deferred;
  deferred = null;
  d.prompt();
  const r = await d.userChoice.catch(() => ({ outcome: 'dismissed' }));
  emit();
  return r.outcome === 'accepted' ? 'accepted' : 'dismissed';
}

let inited = false;
export function initPWA(): void {
  if (inited || typeof window === 'undefined') return;
  inited = true;
  addEventListener('beforeinstallprompt', (e: Event) => { e.preventDefault(); deferred = e; emit(); });
  addEventListener('appinstalled', () => { deferred = null; emit(); });
  // No SW in vite dev (it would cache unhashed modules) or inside the Android TV WebView wrapper.
  if ('serviceWorker' in navigator && !import.meta.env.DEV && !/[?&]app=1/.test(location.search)) {
    addEventListener('load', () => { navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href).catch(() => {}); });
  }
}
