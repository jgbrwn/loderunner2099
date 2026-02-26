import Phaser from 'phaser';
import { CONFIG } from './config';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

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
(window as any).__GAME__ = game;

console.log('%c LODE RUNNER 2099 ', 'background: #0a0a1a; color: #00ffff; font-size: 20px; font-weight: bold;');
console.log('%c Procedural retro gaming ', 'color: #ff00ff');
