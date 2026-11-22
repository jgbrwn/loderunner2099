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

// Global input manager: owns the window key listeners for the app's lifetime.
getInput();
initPWA();
lockGestures();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: CONFIG.GAME_WIDTH,
  height: CONFIG.GAME_HEIGHT,
  backgroundColor: '#0a0a1a',
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, GameScene],
};

const game = new Phaser.Game(config);
game.events.once('ready', () => hideSplash());
initTouchOverlay(game);
(window as any).__GAME__ = game;
(window as any).__INPUT__ = getInput();
