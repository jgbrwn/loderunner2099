import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }
  
  preload(): void {
    // We're using procedural graphics, so minimal loading
    // Could load fonts, sounds here later
    
    // Show loading text
    const text = this.add.text(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
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
    // Check for URL parameters
    const params = new URLSearchParams(window.location.hash.slice(1));
    const seed = params.get('seed');
    const diff = params.get('diff');
    
    if (seed) {
      // Direct to game with seed
      this.scene.start('GameScene', {
        seed: seed,
        difficulty: diff || 'normal'
      });
    } else {
      // Go to menu
      this.scene.start('MenuScene');
    }
  }
}
