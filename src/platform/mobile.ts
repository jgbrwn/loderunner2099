// Stop browser gestures from fighting the game: pinch/double-tap zoom, long-press menus, pull-to-refresh.
export function lockGestures(): void {
  const stop = (e: Event) => e.preventDefault();
  const notField = (e: Event) => !(e.target as HTMLElement | null)?.closest?.('input,textarea,select');
  document.addEventListener('contextmenu', e => { if (notField(e)) e.preventDefault(); });
  document.addEventListener('gesturestart', stop as EventListener); // iOS pinch
  document.addEventListener('touchmove', e => { if (e.touches.length > 1 || notField(e)) e.preventDefault(); }, { passive: false });
  let last = 0;
  document.addEventListener('touchend', e => { // iOS double-tap zoom
    const now = e.timeStamp;
    if (now - last < 300 && notField(e)) e.preventDefault();
    last = now;
  }, { passive: false });
}
