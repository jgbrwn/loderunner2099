// Screen Wake Lock while `want()` is true (polled every 2 s + on visibility change). Returns a disposer.
export function keepAwake(want: () => boolean): () => void {
  let lock: any = null, pending = false;
  const tick = async () => {
    const nav = navigator as any;
    if (!nav.wakeLock || pending) return;
    const should = want() && !document.hidden;
    if (should && !lock) {
      pending = true;
      try { lock = await nav.wakeLock.request('screen'); lock.addEventListener?.('release', () => { lock = null; }); } catch { /* denied */ }
      pending = false;
    } else if (!should && lock) { lock.release?.(); lock = null; }
  };
  const iv = setInterval(tick, 2000);
  document.addEventListener('visibilitychange', tick);
  document.addEventListener('pointerdown', tick, true); // some browsers need a user gesture
  tick();
  return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick); document.removeEventListener('pointerdown', tick, true); lock?.release?.(); lock = null; };
}
