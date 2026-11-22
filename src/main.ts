import Phaser from 'phaser';
import { CONFIG } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { getInput } from './input/InputManager';
import { initTouchOverlay } from './ui/TouchOverlay';
import { initPWA } from './platform/pwa';
import { hideSplash } from './platform/splash';
import { lockGestures } from './platform/mobile';
import { CANVAS_W, CANVAS_H, patchTextResolution, hiResGame } from './graphics/HiRes';

// Global input manager: owns the window key listeners for the app's lifetime.
getInput();
initPWA();
lockGestures();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: CANVAS_W,   // 2x internal resolution; scenes lay out in CONFIG.GAME_WIDTH x GAME_HEIGHT (see graphics/HiRes)
  height: CANVAS_H,
  backgroundColor: '#0a0a1a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene],
};

patchTextResolution();
const game = new Phaser.Game(config);
hiResGame(game);
game.events.once('ready', () => hideSplash());
initTouchOverlay(game);
(window as any).__GAME__ = game;
(window as any).__INPUT__ = getInput();
