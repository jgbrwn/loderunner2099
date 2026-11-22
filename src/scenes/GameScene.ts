import Phaser from 'phaser';
import { CONFIG, DIFFICULTIES, THEMES, Theme } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { FieldView } from '../graphics/FieldView';
import { Hud } from '../graphics/Hud';
import { computeLayout, FIELD_W, FIELD_H } from '../graphics/Layout';
import { CRTEffect } from '../graphics/CRTEffect';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';
import { getInput } from '../input/InputManager';
import { World } from '../sim/World';
import { TICK_MS, type SimEvent, type SimInput } from '../sim/types';


/** Renders the deterministic sim (src/sim) and handles session flow (lives, levels, menus). */
export class GameScene extends Phaser.Scene {
  private world!: World;
  private levelMap!: TileMap;
  /** Playfield renderer; placed by computeLayout(). Split-screen = two FieldViews + two Huds. */
  private view!: FieldView;
  private hud!: Hud;
  private now = 0;
  private crtEffect!: CRTEffect;
  private removeTouch: (() => void) | null = null;

  private score = 0;
  private lives = 3;
  private level = 1;
  private numPlayers = 1;
  private seedCode = '';
  private difficulty = 'normal';
  private theme: Theme = THEMES.cyber;
  private themeKeys = Object.keys(THEMES);
  private themeIndex = 0;
  private speedIndex: number = CONFIG.DEFAULT_SPEED_INDEX;
  private paused = false;
  private gameOver = false;
  private transitioning = false;
  private acc = 0;
  private lastStepSound = 0;
  private escArmedUntil = 0;
  private leaving = false;

  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: Phaser.Time.TimerEvent | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() { super({ key: 'GameScene' }); }

  init(data: { difficulty?: string; seed?: string; players?: number }): void {
    this.difficulty = data.difficulty && DIFFICULTIES[data.difficulty] ? data.difficulty : 'normal';
    this.seedCode = data.seed || generateSeedCode();
    this.numPlayers = data.players === 2 ? 2 : 1;
    this.score = 0;
    this.lives = DIFFICULTIES[this.difficulty].lives;
    this.level = 1;
    this.gameOver = false;
    this.paused = false;
    this.transitioning = false;
    this.acc = 0;
    this.escArmedUntil = 0;
    this.leaving = false;
  }

  create(): void {
    this.events.once('shutdown', this.cleanup, this);
    const input = getInput();
    input.keyboard && (input.keyboard.letters = true);
    input.setTwoPlayerKeys(this.numPlayers === 2);
    getSoundManager().resume();

    this.now = this.time.now;
    const layout = computeLayout(1)[0];
    this.view = new FieldView(this, layout, this.theme);
    this.hud = new Hud(this, layout.hud, this.theme);

    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    kb.resetKeys();
    this.keys = {
      plus: kb.addKey(K.PLUS), plus2: kb.addKey(K.NUMPAD_ADD), minus: kb.addKey(K.MINUS), minus2: kb.addKey(K.NUMPAD_SUBTRACT),
      restart: kb.addKey(K.R), newLevel: kb.addKey(K.N), theme: kb.addKey(K.T), crt: kb.addKey(K.C),
      mute: kb.addKey(K.M), music: kb.addKey(K.B),
    };

    this.messageText = this.add.text(layout.x + FIELD_W * layout.scale / 2, layout.y + FIELD_H * layout.scale / 2 - 40, '', {
      fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(100);

    this.cameras.main.setBackgroundColor(this.theme.background);
    this.crtEffect = new CRTEffect(this);
    if (!this.theme.scanlines) this.crtEffect.setIntensity(0.3);

    // touch input: global DOM overlay (src/ui/TouchOverlay.ts), registered in main.ts

    this.newLevel();
    this.updateShareURL();
  }

  private cleanup(): void {
    this.removeTouch?.();
    this.removeTouch = null;
    this.crtEffect?.destroy();
    this.view?.destroy();
    this.hud?.destroy();
    this.messageTimer = null;
    const sm = getSoundManager();
    sm.setEscape?.(false);
    sm.stopMusic();
    getInput().setTwoPlayerKeys(false);
  }

  // ---------------- level lifecycle ----------------
  private newLevel(): void {
    const gen = new LevelGenerator(`${this.seedCode}-L${this.level}`, this.difficulty, this.level);
    this.levelMap = gen.generateWithInfo().map;
    this.startWorld();
    getSoundManager().startLevelMusic(this.seedCode, this.level, this.difficulty);
  }

  /** (Re)start the current level from the stored map. */
  private startWorld(): void {
    const d = DIFFICULTIES[this.difficulty];
    this.world = new World(this.levelMap, {
      seed: `${this.seedCode}-L${this.level}`, players: this.numPlayers, enemySpeed: d.enemySpeed, holeTime: d.holeTime,
    });
    this.acc = 0;
    this.transitioning = false;
    getSoundManager().setEscape?.(false);
    this.view.setWorld(this.world, this.now);
    this.updateHUD();
  }

  // ---------------- main loop ----------------
  update(time: number, delta: number): void {
    this.now = time;
    const input = getInput();
    input.update();
    this.handleSystemKeys(time);
    if (this.leaving) return;

    const running = !this.paused && !this.gameOver && !this.transitioning && this.world.status === 'playing'
      && this.view.introDone(time);
    if (running) {
      this.acc += Math.min(delta, 250) * CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
      const inputs: SimInput[] = [];
      for (let p = 0; p < this.numPlayers; p++) {
        const a = input.get(p);
        inputs.push({ left: a.left, right: a.right, up: a.up, down: a.down, digLeft: a.digLeft, digRight: a.digRight });
      }
      let steps = 0;
      while (this.acc >= TICK_MS && steps++ < 12) {
        this.acc -= TICK_MS;
        this.world.tick(inputs);
        for (const e of this.world.drainEvents()) this.onEvent(e, time);
        if (this.world.status !== 'playing') break;
      }
      if (steps >= 12) this.acc = 0;
      this.updateMusicIntensity();
    }
    this.view.render(time);
    this.crtEffect.update();
    this.updateHUD();
  }

  private handleSystemKeys(time: number): void {
    const input = getInput();
    const JD = Phaser.Input.Keyboard.JustDown;
    const k = this.keys;
    if (input.anyJustPressed('back')) {
      if (time < this.escArmedUntil) { this.returnToMenu(); return; }
      this.escArmedUntil = time + 2000;
      this.showMessage('Press ESC / BACK again for menu', 2000);
    }
    if (input.anyJustPressed('pause')) this.togglePause();
    if (this.gameOver && input.anyJustPressed('confirm')) this.restartGame();
    if (JD(k.theme)) this.cycleTheme();
    if (JD(k.crt)) this.showMessage(this.crtEffect.toggle() ? 'CRT ON' : 'CRT OFF', 1000);
    if (JD(k.mute)) this.showMessage(getSoundManager().toggle() ? 'SOUND ON' : 'SOUND OFF', 1000);
    if (JD(k.music)) this.showMessage(getSoundManager().toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', 1000);
    if (JD(k.restart)) { if (this.gameOver) this.restartGame(); else { this.startWorld(); this.showMessage(''); } }
    if (JD(k.newLevel)) { this.seedCode = generateSeedCode(); this.restartGame(); this.updateShareURL(); }
    if (JD(k.plus) || JD(k.plus2)) this.speedIndex = Math.min(this.speedIndex + 1, CONFIG.SPEED_MULTIPLIERS.length - 1);
    if (JD(k.minus) || JD(k.minus2)) this.speedIndex = Math.max(this.speedIndex - 1, 0);
  }

  private helpText(): string {
    const move = this.numPlayers === 2 ? 'P1 WASD + Q/E   P2 ARROWS + ,/.' : 'ARROWS move   Z/X dig';
    return `${move}\nT theme  C CRT  M sound  B music\n+/- speed  R restart  ESC menu`;
  }

  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;
    const sm = getSoundManager();
    if (this.paused) { sm.pauseMusic(); this.showMessage(`PAUSED\n\nP / START to resume\n\n${this.helpText()}`); }
    else { sm.resumeMusic(); this.showMessage(''); }
  }

  private onEvent(e: SimEvent, time: number): void {
    const sm = getSoundManager();
    this.view.onEvent(e, time);
    switch (e.t) {
      case 'score': this.score += e.amount; break;
      case 'digStart': sm.playDig(); break;
      case 'holeFill': sm.playHoleFill(); break;
      case 'gold': sm.playGold(); break;
      case 'trap': sm.playEnemyTrapped(); break;
      case 'fall': sm.playFall(); break;
      case 'step':
        if (time - this.lastStepSound > 90) { e.climb ? sm.playClimb() : sm.playStep(); this.lastStepSound = time; }
        break;
      case 'exitReveal':
        sm.playExitAppear(); sm.setEscape?.(true);
        this.showMessage('EXIT AT TOP!', 2000);
        break;
      case 'playerDeath':
        sm.playDeath();
        this.lives--;
        if (this.lives <= 0) this.endGame();
        else if (this.world.players.some(p => p.alive)) this.showMessage(`P${e.p + 1} DOWN  LIVES: ${this.lives}`, 1200);
        break;
      case 'failed':
        if (this.gameOver) break;
        this.transitioning = true;
        this.showMessage(`LIVES: ${this.lives}`, 1500);
        this.time.delayedCall(1500, () => this.startWorld());
        break;
      case 'complete': this.winLevel(); break;
    }
  }

  private updateMusicIntensity(): void {
    const w = this.world;
    const total = Math.max(1, w.golds.length);
    let near = 0;
    for (const p of w.players) {
      if (!p.alive) continue;
      for (const g of w.guards) {
        if (g.mode === 'dead') continue;
        const d = Math.abs(g.cx - p.cx) + Math.abs(g.cy - p.cy);
        near = Math.max(near, 1 - Math.min(d, 10) / 10);
      }
    }
    getSoundManager().setIntensity?.(0.7 * (1 - w.goldRemaining() / total) + 0.3 * near);
  }

  // ---------------- session flow ----------------
  private winLevel(): void {
    this.transitioning = true;
    this.lives++;
    const sm = getSoundManager();
    sm.stopMusic();
    sm.playLevelComplete();
    this.showMessage(`LEVEL ${this.level} COMPLETE!\n\n+1500 BONUS\n+1 LIFE!`, 2000);
    this.level++;
    this.time.delayedCall(1100, () => this.view.playOutro(this.now));
    this.time.delayedCall(2150, () => this.newLevel());
  }

  private endGame(): void {
    this.gameOver = true;
    getSoundManager().stopMusic();
    const hs = getHighScores();
    const restart = '\n\nR / ENTER to restart';
    if (hs.isHighScore(this.score)) {
      const rank = hs.addScore({ name: 'PLAYER', score: this.score, level: this.level, difficulty: this.difficulty, seed: this.seedCode });
      this.showMessage(`GAME OVER\n\nNEW HIGH SCORE!\nRANK: #${rank}\nSCORE: ${this.score}${restart}`);
    } else {
      const top = hs.getTopScore();
      this.showMessage(`GAME OVER\n\nSCORE: ${this.score}${top ? `\nHIGH SCORE: ${top.score}` : ''}${restart}`);
    }
  }

  private restartGame(): void {
    this.lives = DIFFICULTIES[this.difficulty].lives;
    this.score = 0;
    this.level = 1;
    this.gameOver = false;
    this.paused = false;
    this.showMessage('');
    this.newLevel();
  }

  private returnToMenu(): void {
    this.leaving = true;
    this.scene.start('MenuScene');
  }

  private cycleTheme(): void {
    this.themeIndex = (this.themeIndex + 1) % this.themeKeys.length;
    this.theme = THEMES[this.themeKeys[this.themeIndex]];
    this.cameras.main.setBackgroundColor(this.theme.background);
    this.view.setTheme(this.theme);
    this.hud.setTheme(this.theme);
    this.crtEffect.applyTheme(this.theme);
    getSoundManager().playMenuSelect();
  }

  private showMessage(text: string, duration?: number): void {
    this.messageText.setText(text);
    this.messageTimer?.remove();
    this.messageTimer = duration ? this.time.delayedCall(duration, () => this.messageText.setText('')) : null;
  }

  private updateHUD(): void {
    const sm = getSoundManager();
    this.hud.update({
      score: this.score, lives: this.lives, level: this.level,
      goldTotal: this.world.golds.length, goldLeft: this.world.goldRemaining(),
      difficulty: DIFFICULTIES[this.difficulty].name, seed: this.seedCode,
      music: sm.getMusicMode ? sm.getMusicMode() : (sm.isMusicEnabled() ? 'procedural' : 'off'),
    });
  }

  private shareParams(): URLSearchParams {
    const p = new URLSearchParams({ seed: this.seedCode, diff: this.difficulty, g: '2' });
    if (this.numPlayers === 2) p.set('p', '2');
    return p;
  }
  private updateShareURL(): void {
    window.history.replaceState({}, '', `${window.location.pathname}?${this.shareParams()}`);
  }
  getShareURL(): string {
    return `${window.location.origin}${window.location.pathname}?${this.shareParams()}`;
  }
}
