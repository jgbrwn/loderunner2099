import Phaser from 'phaser';
import { CONFIG, DIFFICULTIES, THEMES, Theme } from '../config';
import { TileMap } from '../level/TileMap';
import { LevelGenerator } from '../level/LevelGenerator';
import { FieldView } from '../graphics/FieldView';
import { Hud } from '../graphics/Hud';
import { computeLayout, type FieldLayout } from '../graphics/Layout';
import { CRTEffect } from '../graphics/CRTEffect';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager, type MusicMode } from '../audio/SoundManager';
import { getHighScores } from '../systems/HighScores';
import { Settings } from '../systems/Settings';
import { getInput, type Action } from '../input/InputManager';
import { World } from '../sim/World';
import { TICK_MS, type SimEvent, type SimInput } from '../sim/types';
import type { TVPairing, TVState } from '../platform/pairing';

export type GameMode = 'single' | 'coop' | 'versus';
export interface GameInitData { difficulty?: string; seed?: string; mode?: GameMode; tv?: boolean; players?: number }

/** One playfield: a World + its renderer + HUD. Single/co-op use one board; versus uses two (same level). */
interface Board {
  world: World; view: FieldView; hud: Hud; layout: FieldLayout;
  /** Input slot of each sim player on this board. */
  inputs: number[];
  scores: number[];   // per input slot (session total)
  acc: number;
  waiting: boolean;   // failed, restart pending
  wins: number;       // versus round wins
}

type MenuItem = { label: () => string; act?: () => void; adj?: (d: number) => void };

const MUSIC_MODES: MusicMode[] = ['procedural', 'radio', 'off'];

/** Renders the deterministic sim (src/sim) and handles session flow (lives, levels, pause menu, versus rounds). */
export class GameScene extends Phaser.Scene {
  private boards: Board[] = [];
  private levelMap!: TileMap;
  private now = 0;
  private crtEffect!: CRTEffect;

  private mode: GameMode = 'single';
  private tvMode = false;
  private lives = 3;
  private level = 1;
  private seedCode = '';
  private difficulty = 'normal';
  private theme: Theme = THEMES.cyber;
  private themeKeys = Object.keys(THEMES);
  private themeIndex = 0;
  private speedIndex: number = CONFIG.DEFAULT_SPEED_INDEX;
  /** Public: the TV idle screen watches this. */
  paused = false;
  private gameOver = false;
  private transitioning = false;
  private lastStepSound = 0;
  private lastIntensity = 0;
  private leaving = false;
  private tvKey = '';

  private messageText!: Phaser.GameObjects.Text;
  private messageTimer: Phaser.Time.TimerEvent | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  private menu: Phaser.GameObjects.Container | null = null;
  private menuText: Phaser.GameObjects.Text | null = null;
  private menuItems: MenuItem[] = [];
  private menuSel = 0;
  private menuPage: 'main' | 'options' = 'main';

  constructor() { super({ key: 'GameScene' }); }

  init(data: GameInitData): void {
    this.difficulty = data.difficulty && DIFFICULTIES[data.difficulty] ? data.difficulty : 'normal';
    this.seedCode = data.seed || generateSeedCode();
    this.mode = data.mode === 'coop' || data.mode === 'versus' ? data.mode : data.players === 2 ? 'coop' : 'single';
    this.tvMode = !!data.tv;
    this.lives = DIFFICULTIES[this.difficulty].lives;
    this.level = 1;
    this.gameOver = this.paused = this.transitioning = this.leaving = false;
    this.boards = [];
    this.menu = null;
    this.tvKey = '';
    this.themeIndex = Math.max(0, this.themeKeys.indexOf(Settings.theme));
    this.theme = THEMES[this.themeKeys[this.themeIndex]];
    this.speedIndex = Settings.speedIndex;
  }

  private get numPlayers(): number { return this.mode === 'single' ? 1 : 2; }
  private get tv(): TVPairing | undefined { return this.registry.get('tvPairing') as TVPairing | undefined; }

  create(): void {
    this.events.once('shutdown', this.cleanup, this);
    const input = getInput();
    input.keyboard && (input.keyboard.letters = true);
    input.setTwoPlayerKeys(this.numPlayers === 2);
    input.swallow();
    getSoundManager().resume();

    this.now = this.time.now;
    const layouts = computeLayout(this.mode === 'versus' ? 2 : 1);
    for (let i = 0; i < layouts.length; i++) {
      const layout = layouts[i];
      this.boards.push({
        world: null as unknown as World, layout,
        view: new FieldView(this, layout, this.theme), hud: new Hud(this, layout.hud, this.theme),
        inputs: this.mode === 'versus' ? [i] : this.mode === 'coop' ? [0, 1] : [0],
        scores: [0, 0], acc: 0, waiting: false, wins: 0,
      });
      if (this.mode === 'versus') this.boards[i].view.playerIndexOffset = i;
    }

    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    kb.resetKeys();
    this.keys = {
      plus: kb.addKey(K.PLUS), plus2: kb.addKey(K.NUMPAD_ADD), minus: kb.addKey(K.MINUS), minus2: kb.addKey(K.NUMPAD_SUBTRACT),
      restart: kb.addKey(K.R), newLevel: kb.addKey(K.N), theme: kb.addKey(K.T), crt: kb.addKey(K.C),
      mute: kb.addKey(K.M), music: kb.addKey(K.B),
    };

    this.messageText = this.add.text(CONFIG.GAME_WIDTH / 2, CONFIG.GAME_HEIGHT / 2 - 30, '', {
      fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 5,
    }).setOrigin(0.5).setDepth(100).setResolution(2);

    this.cameras.main.setBackgroundColor(this.theme.background);
    this.crtEffect = new CRTEffect(this);
    if (!this.theme.scanlines) this.crtEffect.setIntensity(0.3);
    if (!Settings.crt) this.crtEffect.setEnabled(false);

    this.newLevel();
    this.updateShareURL();
    if (this.mode === 'versus') this.showMessage('VERSUS — FIRST TO CLEAR WINS', 2200);
  }

  private cleanup(): void {
    this.crtEffect?.destroy();
    for (const b of this.boards) { b.view.destroy(); b.hud.destroy(); }
    this.boards = [];
    this.menu?.destroy(); this.menu = null;
    this.messageTimer = null;
    const sm = getSoundManager();
    sm.setEscape(false);
    sm.stopMusic();
    getInput().setTwoPlayerKeys(false);
  }

  // ---------------- level lifecycle ----------------
  private newLevel(): void {
    const gen = new LevelGenerator(`${this.seedCode}-L${this.level}`, this.difficulty, this.level);
    this.levelMap = gen.generateWithInfo().map;
    for (const b of this.boards) this.startWorld(b);
    this.transitioning = false;
    getSoundManager().startLevelMusic(this.seedCode, this.level, this.difficulty);
  }

  /** (Re)start the current level on one board from the stored map. */
  private startWorld(b: Board): void {
    const d = DIFFICULTIES[this.difficulty];
    b.world = new World(this.levelMap, {
      seed: `${this.seedCode}-L${this.level}`, players: b.inputs.length, enemySpeed: d.enemySpeed, holeTime: d.holeTime,
    });
    b.acc = 0;
    b.waiting = false;
    if (!this.boards.some(o => o !== b && o.world?.exitsRevealed)) getSoundManager().setEscape(false);
    b.view.setWorld(b.world, this.now);
  }

  private restartLevel(): void {
    for (const b of this.boards) this.startWorld(b);
    this.transitioning = false;
    getSoundManager().setEscape(false);
  }

  // ---------------- main loop ----------------
  update(time: number, delta: number): void {
    this.now = time;
    const input = getInput();
    input.update();
    if (this.menu) this.updateMenu();
    else this.handleSystemKeys();
    if (this.leaving) return;

    if (!this.paused && !this.gameOver && !this.transitioning) {
      const speed = CONFIG.SPEED_MULTIPLIERS[this.speedIndex];
      for (const b of this.boards) {
        if (b.waiting || b.world.status !== 'playing' || !b.view.introDone(time)) continue;
        b.acc += Math.min(delta, 250) * speed;
        const inputs: SimInput[] = b.inputs.map(i => {
          const a = input.get(i);
          return { left: a.left, right: a.right, up: a.up, down: a.down, digLeft: a.digLeft, digRight: a.digRight };
        });
        let steps = 0;
        while (b.acc >= TICK_MS && steps++ < 12) {
          b.acc -= TICK_MS;
          b.world.tick(inputs);
          for (const e of b.world.drainEvents()) this.onEvent(b, e, time);
          if (b.world.status !== 'playing' || this.transitioning || this.gameOver) break;
        }
        if (steps >= 12) b.acc = 0;
        if (this.transitioning || this.gameOver) break;
      }
      if (time - this.lastIntensity > 200) { this.lastIntensity = time; this.updateMusicIntensity(); }
    }
    for (const b of this.boards) b.view.render(time);
    this.crtEffect.update();
    this.updateHUD();
    this.sendTVState();
  }

  private handleSystemKeys(): void {
    const input = getInput();
    const JD = Phaser.Input.Keyboard.JustDown;
    const k = this.keys;
    if (this.gameOver) {
      if (input.anyJustPressed('confirm') || JD(k.restart)) this.restartGame();
      else if (input.anyJustPressed('back')) this.returnToMenu();
      return;
    }
    if (input.anyJustPressed('pause') || input.anyJustPressed('back')) { this.openMenu(); return; }
    if (JD(k.theme)) this.cycleTheme(1);
    if (JD(k.crt)) this.showMessage(this.toggleCRT() ? 'CRT ON' : 'CRT OFF', 1000);
    if (JD(k.mute)) this.showMessage(getSoundManager().toggle() ? 'SOUND ON' : 'SOUND OFF', 1000);
    if (JD(k.music)) this.showMessage(`MUSIC: ${this.cycleMusic(1).toUpperCase()}`, 1000);
    if (JD(k.restart) && !this.transitioning) { this.restartLevel(); this.showMessage(''); }
    if (JD(k.newLevel)) { this.seedCode = generateSeedCode(); this.restartGame(); this.updateShareURL(); }
    if (JD(k.plus) || JD(k.plus2)) this.setSpeed(1);
    if (JD(k.minus) || JD(k.minus2)) this.setSpeed(-1);
  }

  // ---------------- pause menu ----------------
  private helpText(): string {
    return this.numPlayers === 2 ? 'P1 WASD + Q/E    P2 ARROWS + ,/.' : 'ARROWS move   Z/X dig';
  }

  private openMenu(): void {
    if (this.menu || this.gameOver) return;
    this.paused = true;
    getSoundManager().pauseMusic();
    this.showMessage('');
    const W = CONFIG.GAME_WIDTH, H = CONFIG.GAME_HEIGHT;
    const c = this.add.container(0, 0).setDepth(200);
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.62).fillRect(0, 0, W, H);
    g.fillStyle(this.theme.hudBg, 0.95).fillRoundedRect(W / 2 - 200, H / 2 - 150, 400, 300, 10);
    g.lineStyle(2, this.theme.hudText, 0.9).strokeRoundedRect(W / 2 - 200, H / 2 - 150, 400, 300, 10);
    this.menuText = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', align: 'center', lineSpacing: 8,
    }).setOrigin(0.5).setResolution(2);
    c.add([g, this.menuText]);
    this.menu = c;
    this.setMenuPage('main');
  }

  private closeMenu(): void {
    this.menu?.destroy();
    this.menu = null; this.menuText = null;
    this.paused = false;
    getInput().swallow();
    getSoundManager().resumeMusic();
  }

  private setMenuPage(page: 'main' | 'options'): void {
    this.menuPage = page;
    this.menuSel = 0;
    const sm = getSoundManager();
    const fx = (fn: (d: number) => unknown) => (d = 1) => { fn(d); sm.playMenuSelect(); };
    this.menuItems = page === 'main' ? [
      { label: () => 'RESUME', act: () => this.closeMenu() },
      { label: () => 'RESTART LEVEL', act: () => { this.closeMenu(); if (!this.transitioning) this.restartLevel(); } },
      { label: () => 'OPTIONS', act: () => this.setMenuPage('options') },
      { label: () => 'QUIT TO MENU', act: () => this.returnToMenu() },
    ] : [
      { label: () => `MUSIC  ◀ ${sm.getMusicMode().toUpperCase()} ▶`, act: fx(() => this.cycleMusic(1)), adj: fx(d => this.cycleMusic(d)) },
      { label: () => `SOUND  ◀ ${sm.isEnabled() ? 'ON' : 'OFF'} ▶`, act: fx(() => sm.toggle()), adj: fx(() => sm.toggle()) },
      { label: () => `CRT  ◀ ${this.crtOn() ? 'ON' : 'OFF'} ▶`, act: fx(() => this.toggleCRT()), adj: fx(() => this.toggleCRT()) },
      { label: () => `THEME  ◀ ${this.theme.name.toUpperCase()} ▶`, act: () => this.cycleTheme(1), adj: d => this.cycleTheme(d) },
      { label: () => `SPEED  ◀ x${CONFIG.SPEED_MULTIPLIERS[this.speedIndex]} ▶`, act: fx(() => this.setSpeed(1, true)), adj: fx(d => this.setSpeed(d)) },
      { label: () => 'BACK', act: () => this.setMenuPage('main') },
    ];
    this.renderMenu();
  }

  private renderMenu(): void {
    if (!this.menuText) return;
    const title = this.menuPage === 'main' ? 'PAUSED' : 'OPTIONS';
    const lines = this.menuItems.map((it, i) => (i === this.menuSel ? `» ${it.label()} «` : it.label()));
    const foot = this.menuPage === 'main' ? `\n${this.helpText()}` : '';
    this.menuText.setText(`${title}\n\n${lines.join('\n')}\n${foot}`);
    this.menuText.setFontSize(this.menuPage === 'main' ? 20 : 18);
  }

  private updateMenu(): void {
    const input = getInput();
    const jp = (a: Action) => input.anyJustPressed(a);
    const sm = getSoundManager();
    const n = this.menuItems.length;
    if (jp('up')) { this.menuSel = (this.menuSel + n - 1) % n; sm.playMenuSelect(); }
    else if (jp('down')) { this.menuSel = (this.menuSel + 1) % n; sm.playMenuSelect(); }
    else if (jp('left') || jp('right')) this.menuItems[this.menuSel].adj?.(jp('left') ? -1 : 1);
    else if (jp('confirm') || jp('digRight')) { sm.playMenuConfirm(); this.menuItems[this.menuSel].act?.(); }
    else if (jp('pause')) this.closeMenu();
    else if (jp('back') || jp('digLeft')) { if (this.menuPage === 'options') this.setMenuPage('main'); else this.closeMenu(); }
    else return;
    this.renderMenu();
  }

  // ---------------- options ----------------
  private crtOn(): boolean { return Settings.crt; }
  private toggleCRT(): boolean {
    const on = this.crtEffect.toggle();
    Settings.crt = on;
    return on;
  }
  private cycleMusic(d: number): MusicMode {
    const sm = getSoundManager();
    const i = MUSIC_MODES.indexOf(sm.getMusicMode());
    const m = MUSIC_MODES[(i + d + MUSIC_MODES.length) % MUSIC_MODES.length];
    sm.setMusicMode(m);
    if (this.paused) sm.pauseMusic();
    return m;
  }
  private setSpeed(d: number, wrap = false): void {
    const n = CONFIG.SPEED_MULTIPLIERS.length;
    this.speedIndex = wrap ? (this.speedIndex + d + n) % n : Math.max(0, Math.min(n - 1, this.speedIndex + d));
    Settings.speedIndex = this.speedIndex;
  }
  private cycleTheme(d: number): void {
    const n = this.themeKeys.length;
    this.themeIndex = (this.themeIndex + d + n) % n;
    this.theme = THEMES[this.themeKeys[this.themeIndex]];
    Settings.theme = this.themeKeys[this.themeIndex];
    this.cameras.main.setBackgroundColor(this.theme.background);
    for (const b of this.boards) { b.view.setTheme(this.theme); b.hud.setTheme(this.theme); }
    this.crtEffect.applyTheme(this.theme);
    getSoundManager().playMenuSelect();
  }

  // ---------------- events ----------------
  private onEvent(b: Board, e: SimEvent, time: number): void {
    const sm = getSoundManager();
    const tv = this.tvMode ? this.tv : undefined;
    const slot = (p: number) => b.inputs[p] ?? 0;
    b.view.onEvent(e, time);
    switch (e.t) {
      case 'score': b.scores[slot(e.p)] += e.amount; break;
      case 'digStart': sm.playDig(); break;
      case 'holeFill': sm.playHoleFill(); break;
      case 'gold':
        sm.playGold(); sm.stinger('gold');
        tv?.event('gold', slot(e.p));
        break;
      case 'trap': {
        sm.playEnemyTrapped(); sm.stinger('trap');
        const h = b.world.holes.find(h => h.x === e.x && h.y === e.y);
        const p = h ? slot(h.by) : b.inputs[0];
        tv?.event('trap', p); tv?.rumble(p, 40);
        break;
      }
      case 'fall': sm.playFall(); break;
      case 'step':
        if (time - this.lastStepSound > 90) { e.climb ? sm.playClimb() : sm.playStep(); this.lastStepSound = time; }
        break;
      case 'exitReveal':
        sm.playExitAppear(); sm.setEscape(true); sm.stinger('exit');
        this.showMessage(this.mode === 'versus' ? `P${b.inputs[0] + 1}: EXIT OPEN!` : 'EXIT AT TOP!', 1600);
        break;
      case 'playerDeath':
        sm.playDeath(); sm.stinger('death');
        tv?.rumble(slot(e.p), 300); tv?.event('death', slot(e.p));
        if (this.mode === 'versus') { this.showMessage(`P${slot(e.p) + 1} DOWN`, 1000); break; }
        this.lives--;
        if (this.lives <= 0) this.endGame();
        else if (b.world.players.some(p => p.alive)) this.showMessage(`P${e.p + 1} DOWN  LIVES: ${this.lives}`, 1200);
        break;
      case 'failed':
        if (this.gameOver) break;
        b.waiting = true;
        if (this.mode !== 'versus') { this.transitioning = true; this.showMessage(`LIVES: ${this.lives}`, 1500); }
        this.time.delayedCall(1500, () => {
          if (this.leaving || !b.waiting || !this.boards.includes(b)) return;
          this.startWorld(b);
          if (this.mode !== 'versus') this.transitioning = false;
        });
        break;
      case 'complete': this.winLevel(b); break;
    }
  }

  private updateMusicIntensity(): void {
    let best = 0;
    for (const b of this.boards) {
      const w = b.world;
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
      best = Math.max(best, 0.7 * (1 - w.goldRemaining() / total) + 0.3 * near);
    }
    getSoundManager().setIntensity(best);
  }

  // ---------------- session flow ----------------
  private winLevel(b: Board): void {
    if (this.transitioning) return;
    this.transitioning = true;
    const sm = getSoundManager();
    sm.stinger('clear');
    sm.stopMusic();
    sm.setEscape(false);
    sm.playLevelComplete();
    this.tv?.event('clear');
    if (this.mode === 'versus') {
      b.wins++;
      const [w1, w2] = this.boards.map(x => x.wins);
      this.showMessage(`P${b.inputs[0] + 1} WINS ROUND ${this.level}!\n\n+1500 BONUS\n\nROUNDS  P1 ${w1} : ${w2} P2`, 2600);
      this.time.delayedCall(1700, () => { for (const x of this.boards) x.view.playOutro(this.now); });
      this.time.delayedCall(2750, () => { if (this.leaving) return; this.level++; this.newLevel(); });
      return;
    }
    this.lives++;
    this.showMessage(`LEVEL ${this.level} COMPLETE!\n\n+1500 BONUS\n+1 LIFE!`, 2000);
    this.level++;
    this.time.delayedCall(1100, () => b.view.playOutro(this.now));
    this.time.delayedCall(2150, () => { if (!this.leaving) this.newLevel(); });
  }

  private totalScore(): number { return this.boards.reduce((s, b) => s + b.scores[0] + b.scores[1], 0); }

  private endGame(): void {
    this.gameOver = true;
    getSoundManager().stopMusic();
    const hs = getHighScores();
    const score = this.totalScore();
    const tail = '\n\nENTER / OK restart   ESC / BACK menu';
    const who = this.mode === 'coop' ? 'CO-OP' : 'PLAYER';
    if (hs.isHighScore(score)) {
      const rank = hs.addScore({ name: who, score, level: this.level, difficulty: this.difficulty, seed: this.seedCode });
      this.showMessage(`GAME OVER\n\nNEW HIGH SCORE!\nRANK: #${rank}\nSCORE: ${score}${tail}`);
    } else {
      const top = hs.getTopScore();
      this.showMessage(`GAME OVER\n\nSCORE: ${score}${top ? `\nHIGH SCORE: ${top.score}` : ''}${tail}`);
    }
  }

  private restartGame(): void {
    this.lives = DIFFICULTIES[this.difficulty].lives;
    for (const b of this.boards) { b.scores = [0, 0]; b.wins = 0; }
    this.level = 1;
    this.gameOver = false;
    if (this.menu) this.closeMenu();
    this.paused = false;
    this.showMessage('');
    this.newLevel();
  }

  private returnToMenu(): void {
    if (this.leaving) return;
    this.leaving = true;
    getInput().swallow();
    this.scene.start('MenuScene');
  }

  private showMessage(text: string, duration?: number): void {
    this.messageText.setText(text);
    this.messageTimer?.remove();
    this.messageTimer = duration ? this.time.delayedCall(duration, () => this.messageText.setText('')) : null;
  }

  private updateHUD(): void {
    const sm = getSoundManager();
    const music = sm.getMusicMode();
    const diff = DIFFICULTIES[this.difficulty].name;
    for (const b of this.boards) {
      const w = b.world;
      const base = { level: this.level, goldTotal: w.golds.length, goldLeft: w.goldRemaining(), difficulty: diff, seed: this.seedCode, music };
      if (this.mode === 'versus') {
        const p = b.inputs[0];
        b.hud.update({ ...base, score: b.scores[p], lives: -1, label: `P${p + 1}`, livesIcon: p ? 'life_p2' : 'life_p1', status: `WINS ${b.wins}` });
      } else if (this.mode === 'coop') {
        b.hud.update({ ...base, score: b.scores[0], score2: b.scores[1], lives: this.lives });
      } else {
        b.hud.update({ ...base, score: b.scores[0], lives: this.lives });
      }
    }
  }

  /** Mirror game status to paired phones (TV mode); pads switch dig ↔ BACK/OK from `screen`. */
  private sendTVState(): void {
    if (!this.tvMode) return;
    const tv = this.tv;
    if (!tv) return;
    const w = this.boards[0].world;
    const s: TVState & Record<string, unknown> = {
      screen: this.gameOver ? 'over' : this.menu ? 'pause' : 'play', mode: this.mode, level: this.level,
      lives: this.mode === 'versus' ? undefined : this.lives, score: this.totalScore(),
      gold: [w.golds.length - w.goldRemaining(), w.golds.length],
    };
    if (this.mode === 'versus') s.wins = this.boards.map(b => b.wins);
    const key = JSON.stringify(s);
    if (key === this.tvKey) return;
    this.tvKey = key;
    tv.sendState(s);
  }

  private shareParams(): URLSearchParams {
    const p = new URLSearchParams({ seed: this.seedCode, diff: this.difficulty, g: '2' });
    if (this.mode !== 'single') p.set('mode', this.mode);
    return p;
  }
  private updateShareURL(): void {
    if (this.tvMode) return;
    window.history.replaceState({}, '', `${window.location.pathname}?${this.shareParams()}`);
  }
  getShareURL(): string {
    return `${window.location.origin}${window.location.pathname}?${this.shareParams()}`;
  }
}
