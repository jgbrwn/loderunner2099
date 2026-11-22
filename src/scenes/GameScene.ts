import Phaser from 'phaser';
import { CONFIG, TileType, DIFFICULTIES, THEMES, Theme } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { TileGraphics } from '../graphics/TileGraphics';
import { CRTEffect } from '../graphics/CRTEffect';
import { TouchControls } from '../ui/TouchControls';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';
import { getInput, StateSource } from '../input/InputManager';
import { World } from '../sim/World';
import { TICK_MS, DIG_TICKS, HOLE_WARN_TICKS, type SimEvent, type SimInput, type Actor } from '../sim/types';

type Obj = Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
const TS = CONFIG.TILE_SIZE;
const P2_TINT = 0xffaa33;

/** Renders the deterministic sim (src/sim) and handles session flow (lives, levels, menus). */
export class GameScene extends Phaser.Scene {
  private world!: World;
  private levelMap!: TileMap;
  private tileSprites: Obj[][] = [];
  private tileCache: TileType[][] = [];
  private goldSprites: Obj[] = [];
  private playerSprites: Obj[] = [];
  private guardSprites: Obj[] = [];
  private carrySprites: Obj[] = [];
  private digGfx!: Phaser.GameObjects.Graphics;
  private tileGraphics!: TileGraphics;
  private crtEffect!: CRTEffect;
  private touchControls!: TouchControls;
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

  private hudText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private hudBg!: Phaser.GameObjects.Rectangle;
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

    this.tileGraphics = new TileGraphics(this);
    this.tileGraphics.generateTextures(this.theme);

    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    kb.resetKeys();
    this.keys = {
      plus: kb.addKey(K.PLUS), plus2: kb.addKey(K.NUMPAD_ADD), minus: kb.addKey(K.MINUS), minus2: kb.addKey(K.NUMPAD_SUBTRACT),
      restart: kb.addKey(K.R), newLevel: kb.addKey(K.N), theme: kb.addKey(K.T), crt: kb.addKey(K.C),
      mute: kb.addKey(K.M), music: kb.addKey(K.B),
    };

    const hudY = CONFIG.GRID_HEIGHT * TS;
    this.hudBg = this.add.rectangle(CONFIG.GAME_WIDTH / 2, hudY + TS * 1.5, CONFIG.GAME_WIDTH, TS * 3, this.theme.hudBg).setDepth(50);
    this.hudText = this.add.text(CONFIG.GAME_WIDTH / 2, hudY + 4, '', {
      fontFamily: 'monospace', fontSize: '13px', color: this.hex(this.theme.hudText),
    }).setOrigin(0.5, 0).setDepth(51);
    const help = this.numPlayers === 2
      ? 'P1 WASD+Q/E  P2 Arrows+,/. | P:Pause T:Theme C:CRT M:Mute B:Music R:Restart ESC:Menu'
      : 'Z/X:Dig | +/-:Speed | P:Pause | T:Theme | C:CRT | M:Mute | B:Music | R:Restart | ESC:Menu';
    this.add.text(CONFIG.GAME_WIDTH / 2, hudY + 22, help, { fontFamily: 'monospace', fontSize: '10px', color: '#666688' })
      .setOrigin(0.5, 0).setDepth(51);
    this.messageText = this.add.text(CONFIG.GAME_WIDTH / 2, CONFIG.GAME_HEIGHT / 2 - 50, '', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(100);
    this.digGfx = this.add.graphics().setDepth(15);

    this.cameras.main.setBackgroundColor(this.theme.background);
    this.crtEffect = new CRTEffect(this);
    if (!this.theme.scanlines) this.crtEffect.setIntensity(0.3);

    this.touchControls = new TouchControls(this);
    const tc = this.touchControls;
    this.removeTouch = input.addSource(new StateSource(0, () => ({
      left: tc.left, right: tc.right, up: tc.up, down: tc.down, digLeft: tc.digLeft, digRight: tc.digRight,
    })));

    this.newLevel();
    this.updateShareURL();
  }

  private cleanup(): void {
    this.removeTouch?.();
    this.removeTouch = null;
    this.touchControls?.destroy();
    this.crtEffect?.destroy();
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
    this.buildSprites();
    this.updateHUD();
  }

  private buildSprites(): void {
    for (const row of this.tileSprites) for (const s of row) s?.destroy();
    for (const s of [...this.goldSprites, ...this.playerSprites, ...this.guardSprites, ...this.carrySprites]) s.destroy();
    const w = this.world;
    this.tileSprites = [];
    this.tileCache = [];
    for (let y = 0; y < w.height; y++) {
      this.tileSprites[y] = [];
      this.tileCache[y] = [];
      for (let x = 0; x < w.width; x++) {
        this.tileCache[y][x] = w.tiles[y][x];
        this.tileSprites[y][x] = this.createTileSprite(x, y, w.tiles[y][x]);
      }
    }
    this.goldSprites = w.golds.map(g => this.makeSprite(g.assisted && this.textures.exists('gold_enemy') ? 'gold_enemy' : 'gold', 12, 12, this.theme.gold, 5));
    this.playerSprites = w.players.map(p => {
      const s = this.makeSprite('player_idle', TS - 4, TS - 2, this.theme.player, 10);
      if (p.id === 1) (s as any).setTint?.(P2_TINT);
      return s;
    });
    this.guardSprites = w.guards.map(() => this.makeSprite('enemy_idle', TS - 4, TS - 2, this.theme.enemy, 9));
    this.carrySprites = w.guards.map(() => this.makeSprite('gold', 6, 6, this.theme.gold, 11).setScale(0.45));
    this.renderWorld(0);
  }

  private makeSprite(key: string, w: number, h: number, color: number, depth: number): Obj {
    const o: Obj = this.textures.exists(key) ? this.add.sprite(0, 0, key) : this.add.rectangle(0, 0, w, h, color);
    return o.setDepth(depth);
  }

  private createTileSprite(x: number, y: number, tile: TileType): Obj {
    const px = x * TS + TS / 2, py = y * TS + TS / 2;
    const map: Partial<Record<TileType, [string, number]>> = {
      [TileType.BRICK]: ['brick', this.theme.brick], [TileType.BRICK_TRAP]: ['brick_trap', this.theme.brick],
      [TileType.BRICK_HARD]: ['brick_hard', this.theme.brickHard], [TileType.LADDER]: ['ladder', this.theme.ladder],
      [TileType.LADDER_EXIT]: ['ladder_exit', this.theme.ladder], [TileType.POLE]: ['pole', this.theme.pole],
      [TileType.HOLE]: ['hole', 0x000000],
    };
    const m = map[tile];
    const depth = tile === TileType.POLE ? 1 : 0;
    if (m && this.textures.exists(m[0])) return this.add.sprite(px, py, m[0]).setDepth(depth);
    return this.add.rectangle(px, py, TS, TS, m ? m[1] : this.theme.background).setDepth(depth);
  }

  // ---------------- main loop ----------------
  update(time: number, delta: number): void {
    const input = getInput();
    input.update();
    this.handleSystemKeys(time);
    if (this.leaving) return;

    const running = !this.paused && !this.gameOver && !this.transitioning && this.world.status === 'playing';
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
    this.renderWorld(time);
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

  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;
    const sm = getSoundManager();
    if (this.paused) { sm.pauseMusic(); this.showMessage('PAUSED\n\nP / START to resume'); }
    else { sm.resumeMusic(); this.showMessage(''); }
  }

  private onEvent(e: SimEvent, time: number): void {
    const sm = getSoundManager();
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

  // ---------------- rendering ----------------
  private placeActor(o: Obj, a: Actor): void {
    o.setPosition(a.cx * TS + a.ox * (TS / 24) + TS / 2, a.cy * TS + a.oy * (TS / 24) + TS / 2);
  }

  private renderWorld(time: number): void {
    const w = this.world;
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) {
      if (this.tileCache[y][x] !== w.tiles[y][x]) {
        this.tileCache[y][x] = w.tiles[y][x];
        this.tileSprites[y][x].destroy();
        this.tileSprites[y][x] = this.createTileSprite(x, y, w.tiles[y][x]);
      }
    }
    for (const h of w.holes) {
      const s = this.tileSprites[h.y][h.x];
      const flash = h.ticks < HOLE_WARN_TICKS && Math.sin(time / 50) > 0;
      if (s instanceof Phaser.GameObjects.Sprite) flash ? s.setTint(0xff0000) : s.clearTint();
      else s.setFillStyle(flash ? 0xff0000 : 0x000000);
    }
    const pulse = 1 + 0.08 * Math.sin(time / 160);
    w.golds.forEach((g, i) => {
      const s = this.goldSprites[i];
      const vis = !g.collected && g.carriedBy < 0;
      s.setVisible(vis);
      if (vis) s.setPosition(g.x * TS + TS / 2, g.y * TS + TS / 2).setScale(g.assisted ? pulse * 1.05 : pulse);
    });
    const anim = Math.floor(time / 150) % 2 === 0 ? '1' : '2';
    w.players.forEach((p, i) => {
      const s = this.playerSprites[i];
      s.setVisible(p.alive || Math.floor(time / 100) % 2 === 0);
      this.placeActor(s, p);
      const f = p.mode === 'run' ? 'walk' + anim : p.mode === 'climb' ? 'climb' + anim : p.mode === 'hang' ? 'hang'
        : p.mode === 'fall' ? 'fall' : p.mode === 'dig' ? 'dig' : 'idle';
      this.setFrame(s, 'player_' + f, p.facing < 0);
    });
    w.guards.forEach((g, i) => {
      const s = this.guardSprites[i], c = this.carrySprites[i];
      const vis = g.mode !== 'dead' && (g.mode !== 'spawning' || Math.floor(time / 80) % 2 === 0);
      s.setVisible(vis);
      c.setVisible(vis && g.carry >= 0);
      if (!vis) return;
      this.placeActor(s, g);
      c.setPosition(s.x, s.y - TS / 2 - 2);
      const f = g.mode === 'trapped' ? 'trapped' : g.mode === 'escape' || g.mode === 'climb' ? 'climb' + anim
        : g.mode === 'hang' ? 'hang' : g.mode === 'run' || g.mode === 'fall' ? 'walk' + anim : 'idle';
      this.setFrame(s, 'enemy_' + f, g.facing < 0);
    });
    // dig cracks
    this.digGfx.clear();
    for (const p of w.players) {
      if (p.mode !== 'dig') continue;
      const prog = 1 - p.digTicks / DIG_TICKS;
      const cx = p.digX * TS + TS / 2, cy = p.digY * TS + TS / 2;
      this.digGfx.lineStyle(2, 0x000000, 0.8);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + prog;
        const len = (TS / 2) * prog * (0.6 + Math.random() * 0.4);
        this.digGfx.lineBetween(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      }
      this.digGfx.fillStyle(0xffff00, 0.9);
      const a = Math.random() * Math.PI * 2;
      this.digGfx.fillRect(cx + Math.cos(a) * 6 * prog - 1, cy + Math.sin(a) * 6 * prog - 1, 2, 2);
    }
  }

  private setFrame(o: Obj, key: string, flip: boolean): void {
    if (!(o instanceof Phaser.GameObjects.Sprite)) return;
    if (o.texture.key !== key && this.textures.exists(key)) o.setTexture(key);
    o.setFlipX(flip);
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
    this.time.delayedCall(2000, () => this.newLevel());
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
    this.tileGraphics.generateTextures(this.theme);
    this.cameras.main.setBackgroundColor(this.theme.background);
    this.hudBg.setFillStyle(this.theme.hudBg);
    this.hudText.setColor(this.hex(this.theme.hudText));
    this.buildSprites();
    this.crtEffect.applyTheme(this.theme);
    getSoundManager().playMenuSelect();
  }

  private hex(c: number): string { return '#' + c.toString(16).padStart(6, '0'); }

  private showMessage(text: string, duration?: number): void {
    this.messageText.setText(text);
    this.messageTimer?.remove();
    this.messageTimer = duration ? this.time.delayedCall(duration, () => this.messageText.setText('')) : null;
  }

  private updateHUD(): void {
    const speed = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
    const music = getSoundManager().isMusicEnabled() ? '♪' : '♪x';
    this.hudText.setText(
      `SCORE: ${this.score.toString().padStart(6, '0')}  LIVES: ${this.lives}  LEVEL: ${this.level}  ` +
      `GOLD: ${this.world.goldRemaining()}  SPD: ${speed}x  ${music}  [${DIFFICULTIES[this.difficulty].name}]  SEED: ${this.seedCode}`,
    );
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
