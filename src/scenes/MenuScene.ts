import Phaser from 'phaser';
import { CONFIG, THEMES, DIFFICULTIES } from '../config';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';

// Global state for seed reset
(window as any).__RESET_SEED_ON_MENU__ = false;

export class MenuScene extends Phaser.Scene {
  private selectedDifficulty: number = 1; // 0=easy, 1=normal, 2=hard, 3=ninja
  private difficultyKeys = ['easy', 'normal', 'hard', 'ninja'];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private difficultyTexts: Phaser.GameObjects.Text[] = [];
  private seedInput: string = '';
  private seedText!: Phaser.GameObjects.Text;
  private highScoreText!: Phaser.GameObjects.Text;
  private shareNotice: Phaser.GameObjects.Text | null = null;
  
  constructor() {
    super({ key: 'MenuScene' });
  }
  
  create(): void {
    const theme = THEMES.cyber;
    this.cameras.main.setBackgroundColor(theme.background);
    
    // Check if we should reset seed (returning from game)
    if ((window as any).__RESET_SEED_ON_MENU__) {
      this.seedInput = '';
      (window as any).__RESET_SEED_ON_MENU__ = false;
    }
    
    // Reset keyboard state to prevent stuck keys
    if (this.input.keyboard) {
      this.input.keyboard.resetKeys();
    }
    
    // Initialize sound system on first interaction
    this.input.once('pointerdown', () => getSoundManager().resume());
    
    // Title
    const title = this.add.text(CONFIG.GAME_WIDTH / 2, 50, 'LODE RUNNER', {
      fontFamily: 'monospace',
      fontSize: '42px',
      color: '#00ffff',
      fontStyle: 'bold'
    });
    title.setOrigin(0.5);
    
    const subtitle = this.add.text(CONFIG.GAME_WIDTH / 2, 95, '2 0 9 9', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ff00ff',
      fontStyle: 'bold'
    });
    subtitle.setOrigin(0.5);
    
    // Glowing effect on title
    this.tweens.add({
      targets: [title, subtitle],
      alpha: { from: 0.7, to: 1 },
      duration: 1000,
      yoyo: true,
      repeat: -1
    });
    
    // High score display - at bottom of menu, above instructions
    const topScore = getHighScores().getTopScore();
    this.highScoreText = this.add.text(CONFIG.GAME_WIDTH / 2, 355, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffff00'
    });
    this.highScoreText.setOrigin(0.5);
    if (topScore) {
      this.highScoreText.setText(`HIGH SCORE: ${topScore.score} by ${topScore.name}`);
    }
    
    // Difficulty selection
    const diffLabel = this.add.text(CONFIG.GAME_WIDTH / 2, 150, 'SELECT DIFFICULTY', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff'
    });
    diffLabel.setOrigin(0.5);
    
    const difficulties = ['EASY', 'NORMAL', 'HARD', 'NINJA'];
    const colors = ['#00ff00', '#00ffff', '#ffaa00', '#ff0044'];
    
    difficulties.forEach((diff, i) => {
      const y = 180 + i * 30;
      const text = this.add.text(CONFIG.GAME_WIDTH / 2, y, diff, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: colors[i]
      });
      text.setOrigin(0.5);
      text.setInteractive({ useHandCursor: true });
      text.on('pointerdown', () => {
        this.selectDifficulty(i);
        this.startGame();
      });
      text.on('pointerover', () => {
        this.selectDifficulty(i);
      });
      this.difficultyTexts.push(text);
    });
    
    // Seed input
    const seedLabel = this.add.text(CONFIG.GAME_WIDTH / 2, 310, 'SEED (ESC to clear):', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888'
    });
    seedLabel.setOrigin(0.5);
    
    this.seedText = this.add.text(CONFIG.GAME_WIDTH / 2, 330, '[ RANDOM ]', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00'
    });
    this.seedText.setOrigin(0.5);
    
    // Reset seed button (X icon)
    const resetSeedBtn = this.add.text(CONFIG.GAME_WIDTH / 2 + 85, 330, '[✕]', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ff4444'
    });
    resetSeedBtn.setOrigin(0.5);
    resetSeedBtn.setInteractive({ useHandCursor: true });
    resetSeedBtn.on('pointerdown', () => {
      this.clearSeedAndNotice();
    });
    resetSeedBtn.on('pointerover', () => resetSeedBtn.setColor('#ff8888'));
    resetSeedBtn.on('pointerout', () => resetSeedBtn.setColor('#ff4444'));
    
    // Instructions
    const instructions = this.add.text(CONFIG.GAME_WIDTH / 2, 390, 
      'Arrow Keys: Move | Z/X: Dig | +/-: Speed\n' +
      'P: Pause | T: Theme | C: CRT | M: Mute\n\n' +
      'Press ENTER or tap to start', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#666688',
      align: 'center'
    });
    instructions.setOrigin(0.5);
    
    // Input
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.enterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    const spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    
    // Keyboard input for seed
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.key.length === 1 && /[A-Za-z0-9]/.test(event.key)) {
        if (this.seedInput.length < 8) {
          this.seedInput += event.key.toUpperCase();
          this.updateSeedDisplay();
        }
      } else if (event.key === 'Backspace') {
        this.seedInput = this.seedInput.slice(0, -1);
        this.updateSeedDisplay();
      } else if (event.key === 'Escape') {
        // Clear seed and shared notice with ESC
        this.clearSeedAndNotice();
      }
    });
    
    spaceKey.on('down', () => this.startGame());
    
    this.updateDifficultyDisplay();
    
    // Parse URL parameters for shared games (after UI is created)
    this.parseURLParams();
  }
  
  update(): void {
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selectDifficulty(Math.max(0, this.selectedDifficulty - 1));
    }
    if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selectDifficulty(Math.min(3, this.selectedDifficulty + 1));
    }
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      this.startGame();
    }
  }
  
  private selectDifficulty(index: number): void {
    if (index !== this.selectedDifficulty) {
      getSoundManager().playMenuSelect();
    }
    this.selectedDifficulty = index;
    this.updateDifficultyDisplay();
  }
  
  private updateDifficultyDisplay(): void {
    this.difficultyTexts.forEach((text, i) => {
      if (i === this.selectedDifficulty) {
        text.setStyle({ fontSize: '26px' });
        text.setText('> ' + ['EASY', 'NORMAL', 'HARD', 'NINJA'][i] + ' <');
      } else {
        text.setStyle({ fontSize: '22px' });
        text.setText(['EASY', 'NORMAL', 'HARD', 'NINJA'][i]);
      }
    });
  }
  
  private updateSeedDisplay(): void {
    if (this.seedInput.length > 0) {
      this.seedText.setText('[ ' + this.seedInput + ' ]');
    } else {
      this.seedText.setText('[ RANDOM ]');
    }
  }
  
  private clearSeedAndNotice(): void {
    this.seedInput = '';
    this.updateSeedDisplay();
    
    // Also remove shared notice if present
    if (this.shareNotice) {
      this.shareNotice.destroy();
      this.shareNotice = null;
    }
    
    // Clear URL params
    if (window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
  
  private startGame(): void {
    getSoundManager().playMenuConfirm();
    const seed = this.seedInput.length > 0 ? this.seedInput : generateSeedCode();
    this.scene.start('GameScene', {
      difficulty: this.difficultyKeys[this.selectedDifficulty],
      seed: seed
    });
  }
  
  /**
   * Parse URL query params for shared game links
   */
  private parseURLParams(): void {
    const params = new URLSearchParams(window.location.search);
    
    const seed = params.get('seed');
    if (seed) {
      this.seedInput = seed.toUpperCase().substring(0, 8);
      this.updateSeedDisplay();
    }
    
    const diff = params.get('diff');
    if (diff && this.difficultyKeys.includes(diff)) {
      const index = this.difficultyKeys.indexOf(diff);
      this.selectedDifficulty = index;
      this.updateDifficultyDisplay();
    }
    
    // If both seed and difficulty are in URL, show "shared game" notice
    if (seed && diff) {
      this.shareNotice = this.add.text(CONFIG.GAME_WIDTH / 2, 122,
        `\u2192 SHARED: ${seed} [${diff.toUpperCase()}] \u2190`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#00ff88'
      });
      this.shareNotice.setOrigin(0.5);
    }
  }
}
