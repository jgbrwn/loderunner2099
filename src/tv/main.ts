// /tv entry: 10-foot UI. Same game + TV menu variant, phone pairing, idle screen, remote Back key, fullscreen prompt.
import { showSplash } from '../platform/splash';
import { TVPairing } from '../platform/pairing';
import { enterFullscreen, fullscreenSupported, isFullscreen } from '../platform/fullscreen';
import { initIdle } from './IdleScreen';

const w = window as any;
w.__LR_TV__ = true;
w.__LR_APP__ = /[?&]app=1\b/.test(location.search);
// Android wrapper: apply saved remote-sideways preference (BT gamepads are fed natively by the app).
import('../systems/Settings').then(({ Settings }) => { try { w.LR2099TV?.setRotateRemote?.(Settings.remoteSideways); } catch { /* not in app */ } });
showSplash();

void import('../main').then(() => boot(w.__GAME__ as import('phaser').Game));

function boot(game: import('phaser').Game): void {
  const tv = new TVPairing();
  tv.onChange = () => game.events.emit('tvpairing', tv);
  game.registry.set('tvPairing', tv);
  w.__TV__ = tv;
  const idle = initIdle(game);
  w.__IDLE__ = idle;

  /** Android TV app Back button. Returns true if handled (false at the root menu → app exits). */
  w.lr2099OnBack = (): boolean => {
    if (idle.dismiss()) return true;
    const sm = game.scene;
    if (sm.isActive('MenuScene')) return (sm.getScene('MenuScene') as any).back();
    // in game: behave like the Escape key (GameScene handles pause / quit confirmation)
    for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
    return true;
  };

  // TV browser (not the app): offer fullscreen — needs a user gesture, so the next OK press does it.
  if (!w.__LR_APP__ && fullscreenSupported() && !isFullscreen()) {
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;left:50%;top:6vh;transform:translateX(-50%);z-index:60;padding:1.4vh 2.4vw;border-radius:10px;'
      + 'background:#05010fe6;border:2px solid #0ff;color:#fff;font:bold 3vh "Courier New",monospace;letter-spacing:.1em;box-shadow:0 0 24px #0ff8';
    tip.textContent = 'PRESS OK FOR FULLSCREEN';
    setTimeout(() => document.body.appendChild(tip), 1500);
    const done = () => { tip.remove(); removeEventListener('keydown', onKey, true); clearTimeout(t); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.code === 'NumpadEnter' || e.key === ' ') {
        e.stopImmediatePropagation(); e.preventDefault();
        void enterFullscreen();
      }
      done();
    };
    addEventListener('keydown', onKey, true);
    const t = setTimeout(done, 15000);
  }
}
