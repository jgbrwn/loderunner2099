import { CONFIG } from '../config';
import Phaser from 'phaser';
import { THEMES, DIFFICULTIES } from '../config';
import { TileGraphics } from '../graphics/TileGraphics';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }
  
  preload(): void {
    // We're using procedural graphics, so minimal loading
    // Could load fonts, sounds here later
    
    // Show loading text
    const text = this.add.text(
      CONFIG.GAME_WIDTH / 2,
      CONFIG.GAME_HEIGHT / 2,
      'INITIALIZING...',
      {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#00ffff'
      }
    );
    text.setOrigin(0.5);
  }
  
  create(): void {
    // Pre-build the default theme atlas so the first level starts without a hitch.
    new TileGraphics(this).generateTextures(THEMES.cyber);
    // Check for URL parameters
    const params = new URLSearchParams(window.location.hash.slice(1));
    const seed = (params.get('seed') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const rawDiff = params.get('diff') || '';
    const diff = DIFFICULTIES[rawDiff] ? rawDiff : 'normal';
    const rawMode = params.get('mode');
    
    if (seed) {
      // Direct to game with seed
      this.scene.start('GameScene', {
        seed: seed,
        difficulty: diff, mode: rawMode === 'coop' || rawMode === 'versus' ? rawMode : undefined
      });
    } else {
      // Go to menu
      this.scene.start('MenuScene');
    }
  }
}
