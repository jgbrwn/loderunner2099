import Phaser from 'phaser';
import { CONFIG } from '../config';

/**
 * Internal render scale. The canvas is GAME_WIDTH*RES x GAME_HEIGHT*RES (1920x1080) while all scenes keep
 * laying out in 960x540 design coords: every scene's main camera gets zoom RES with origin (0,0), and text
 * objects rasterize at RES. Half-scale split-screen fields then render 1:1 (crisp) instead of losing detail.
 */
export const RES = 2;
export const CANVAS_W = CONFIG.GAME_WIDTH * RES;
export const CANVAS_H = CONFIG.GAME_HEIGHT * RES;

let patched = false;
/** Call once before `new Phaser.Game` (patches the text factory). Then `hiResGame(game)`. */
export function patchTextResolution(): void {
  if (patched) return;
  patched = true;
  const proto = Phaser.GameObjects.GameObjectFactory.prototype as any;
  const orig = proto.text;
  if (typeof orig !== 'function') return;
  proto.text = function (this: unknown, ...args: unknown[]) {
    const t = orig.apply(this, args) as Phaser.GameObjects.Text;
    t.setResolution?.(RES);
    return t;
  };
}

/** Zoom every scene's main camera so 960x540 design coords fill the hi-res canvas. */
export function hiResGame(game: Phaser.Game): void {
  const hook = (scene: Phaser.Scene) => {
    const zoom = () => { const c = scene.cameras?.main; if (c) c.setOrigin(0, 0).setZoom(RES).setScroll(0, 0); };
    scene.sys.events.on(Phaser.Scenes.Events.START, zoom);
    scene.sys.events.on(Phaser.Scenes.Events.CREATE, zoom);
  };
  const all = () => (game.scene.scenes as Phaser.Scene[]).forEach(s => { if (!(s as any).__hires) { (s as any).__hires = true; hook(s); } });
  // scenes from config exist after boot; scenes added later are caught on the first step they run
  game.events.once(Phaser.Core.Events.READY, all);
  game.events.on(Phaser.Core.Events.PRE_STEP, all);
}
