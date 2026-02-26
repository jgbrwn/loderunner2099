import Phaser from 'phaser';
import { CONFIG, THEMES, DIFFICULTIES } from '../config';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';

export class MenuScene extends Phaser.Scene {
  private selectedDifficulty: number = 1; // 0=easy, 1=normal, 2=hard, 3=ninja
  private difficultyKeys = ['easy', 'normal', 'hard', 'ninja'];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private difficultyTexts: Phaser.GameObjects.Text[] = [];
  private seedInput: string = '';
  private seedText!: Phaser.GameObjects.Text;
  private highScoreText!: Phaser.GameObjects.Text;
  
  constructor() {
    super({ key: 'MenuScene' });
  }
  
  create(): void {
    const theme = THEMES.cyber;
    this.cameras.main.setBackgroundColor(theme.background);
    
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
    
    // High score display
    const topScore = getHighScores().getTopScore();
    if (topScore) {
      this.highScoreText = this.add.text(CONFIG.GAME_WIDTH / 2, 130, 
        `HIGH SCORE: ${topScore.score} by ${topScore.name}`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffff00'
      });
      this.highScoreText.setOrigin(0.5);
    }
    
    // Difficulty selection
    const diffLabel = this.add.text(CONFIG.GAME_WIDTH / 2, 160, 'SELECT DIFFICULTY', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff'
    });
    diffLabel.setOrigin(0.5);
    
    const difficulties = ['EASY', 'NORMAL', 'HARD', 'NINJA'];
    const colors = ['#00ff00', '#00ffff', '#ffaa00', '#ff0044'];
    
    difficulties.forEach((diff, i) => {
      const y = 195 + i * 32;
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
    const seedLabel = this.add.text(CONFIG.GAME_WIDTH / 2, 335, 'SEED (optional):', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888'
    });
    seedLabel.setOrigin(0.5);
    
    this.seedText = this.add.text(CONFIG.GAME_WIDTH / 2, 355, '[ RANDOM ]', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffff00'
    });
    this.seedText.setOrigin(0.5);
    
    // Instructions
    const instructions = this.add.text(CONFIG.GAME_WIDTH / 2, 410, 
      'CONTROLS: Arrow Keys - Move | Z/X - Dig\n' +
      '+/- Speed | P Pause | T Theme | C CRT | M Mute\n\n' +
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
      }
    });
    
    spaceKey.on('down', () => this.startGame());
    
    this.updateDifficultyDisplay();
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
  
  private startGame(): void {
    getSoundManager().playMenuConfirm();
    const seed = this.seedInput.length > 0 ? this.seedInput : generateSeedCode();
    this.scene.start('GameScene', {
      difficulty: this.difficultyKeys[this.selectedDifficulty],
      seed: seed
    });
  }
}
