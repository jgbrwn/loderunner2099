import Phaser from 'phaser';
import { CONFIG, THEMES, DIFFICULTIES } from '../config';
import { generateSeedCode } from '../utils/SeededRandom';
import { getSoundManager } from '../audio/SoundManager';
import { getInput } from '../input/InputManager';
import { getHighScores } from '../systems/HighScores';
import { Settings } from '../systems/Settings';
import { AttractDemo } from '../menu/AttractDemo';
import { MenuUI, textInput, type Page, type Item } from '../menu/MenuUI';
import { canInstall, iosInstallHint, onInstallAvailable, promptInstall } from '../platform/pwa';
import { fullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from '../platform/fullscreen';
import type { TVPairing } from '../platform/pairing';

type Mode = 'single' | 'coop' | 'versus';
const DIFFS = ['easy', 'normal', 'hard', 'ninja'];
const SEED_RE = /[^A-Z0-9]/g;
let deepLinkDone = false;

export const isTV = (): boolean => !!(window as any).__LR_TV__;
export const dailySeed = (d = new Date()): string =>
  'D' + String(d.getUTCFullYear() % 100).padStart(2, '0') + String(d.getUTCMonth() + 1).padStart(2, '0') + String(d.getUTCDate()).padStart(2, '0');
export const shareUrl = (seed: string, diff: string): string =>
  `${location.origin}/?seed=${encodeURIComponent(seed)}&diff=${diff}&g=2`;

export class MenuScene extends Phaser.Scene {
  private ui: MenuUI | null = null;
  private demo: AttractDemo | null = null;
  private starting = false;
  private seed = '';
  private diff = 'normal';

  constructor() { super({ key: 'MenuScene' }); }

  /** TV back key (window.lr2099OnBack): false at the root menu. */
  back(): boolean { return this.ui ? this.ui.back() : false; }

  create(): void {
    this.starting = false;
    this.events.once('shutdown', this.cleanup, this);
    this.cameras.main.setBackgroundColor(THEMES.cyber.background);
    this.input.keyboard?.resetKeys();
    const im = getInput();
    if (im.keyboard) im.keyboard.letters = false;
    im.swallow();
    this.input.once('pointerdown', () => getSoundManager().resume());
    getSoundManager().playMenuMusic();

    this.demo = new AttractDemo(this);
    const ui = this.ui = new MenuUI(isTV());
    this.seed = Settings.lastSeed;
    this.diff = DIFFS.includes(localStorage.getItem('lr2099.diff') ?? '') ? localStorage.getItem('lr2099.diff')! : 'normal';

    const tv = this.registry.get('tvPairing') as TVPairing | undefined;
    if (tv) {
      tv.sendState({ screen: 'menu' });
      ui.sideRender = (el, big) => this.renderPairing(el, tv, big);
      const upd = () => ui.renderSide();
      this.game.events.on('tvpairing', upd);
      ui.onDestroy(() => this.game.events.off('tvpairing', upd));
    }
    ui.onDestroy(onInstallAvailable(() => ui.render()));
    ui.onDestroy(onFullscreenChange(() => ui.render()));
    ui.push(this.mainPage(tv));
    if (!this.deepLink()) this.cameras.main.fadeIn(300);
  }

  private cleanup(): void {
    this.ui?.destroy(); this.ui = null;
    this.demo?.destroy(); this.demo = null;
    const im = getInput();
    if (im.keyboard) im.keyboard.letters = true;
  }

  update(time: number, delta: number): void {
    const im = getInput();
    im.update();
    this.demo?.update(time, delta);
    if (!this.starting) this.ui?.poll();
  }

  // ---------------- pages ----------------
  private mainPage(tv?: TVPairing): Page {
    const items: Item[] = [
      { label: 'PLAY', act: () => this.ui!.push(this.diffPage('single')), cls: 'accent' },
      { label: tv ? 'CO-OP' : '2 PLAYERS', act: () => this.ui!.push(tv ? this.diffPage('coop') : this.twoPage()) },
      { label: 'VERSUS', act: () => this.ui!.push(this.diffPage('versus')), visible: () => !!tv },
      { label: 'DAILY SEED', value: undefined, act: () => this.start('single', 'normal', dailySeed()) },
      { label: 'ENTER SEED', act: () => this.ui!.push(this.seedPage()) },
    ];
    if (tv) items.push(
      { label: 'PAIR A CONTROLLER', act: () => this.ui!.push({ title: 'PAIR A PHONE', side: true, items: [{ label: 'DONE', act: () => this.ui!.back() }] }) },
      { label: 'DISCONNECT CONTROLLERS', act: () => { tv.kickAll(); this.ui!.toast('CONTROLLERS DISCONNECTED'); } },
      { label: 'NEW PAIRING CODE', act: () => { tv.newCode(); this.ui!.toast('NEW CODE'); } },
    );
    items.push(
      { label: 'OPTIONS', act: () => this.ui!.push(this.optionsPage()) },
      { label: 'HIGH SCORES', act: () => this.ui!.push(this.scoresPage()) },
      { label: 'PLAY ON TV', visible: () => !tv, act: () => this.ui!.push(this.tvPage()) },
      { label: 'INSTALL APP', visible: () => !tv && (canInstall() || iosInstallHint()), act: () => this.install() },
      { label: () => (isFullscreen() ? 'EXIT FULLSCREEN' : 'FULLSCREEN'), visible: () => !(window as any).__LR_APP__ && fullscreenSupported(),
        act: () => { void toggleFullscreen(); } },
    );
    return { items };
  }

  private twoPage(): Page {
    return {
      title: '2 PLAYERS',
      body: 'P1: WASD + Q/E  ·  P2: ARROWS / IJKL + U/O<br>or gamepads',
      items: [
        { label: 'CO-OP  (ONE BOARD)', act: () => this.ui!.push(this.diffPage('coop')) },
        { label: 'VERSUS (SPLIT SCREEN)', act: () => this.ui!.push(this.diffPage('versus')) },
        { label: 'BACK', act: () => this.ui!.back(), cls: 'dim' },
      ],
    };
  }

  private diffPage(mode: Mode, seed?: string): Page {
    const items: Item[] = DIFFS.map(d => ({
      label: d.toUpperCase(),
      act: () => this.start(mode, d, seed),
    }));
    items.push({ label: 'BACK', act: () => this.ui!.back(), cls: 'dim' });
    const title = mode === 'single' ? 'DIFFICULTY' : mode === 'coop' ? 'CO-OP · DIFFICULTY' : 'VERSUS · DIFFICULTY';
    return { title, items, focus: Math.max(0, DIFFS.indexOf(this.diff)) };
  }

  private seedPage(): Page {
    const inp = textInput({ value: this.seed, max: 8, placeholder: 'RANDOM', filter: SEED_RE, onEnter: v => { this.seed = v; this.ui!.render(); } });
    inp.addEventListener('input', () => { this.seed = inp.value; });
    const has = () => this.seed.length > 0;
    return {
      title: 'SEED',
      body: 'Same seed + difficulty = same levels.<br>Share a link to race a friend.',
      items: [
        { label: 'SEED', input: inp },
        { label: 'DIFFICULTY', value: () => this.diff.toUpperCase(), cycle: d => { this.diff = DIFFS[(DIFFS.indexOf(this.diff) + d + 4) % 4]; } },
        { label: 'START', cls: 'accent', act: () => this.start('single', this.diff, this.seed || undefined) },
        { label: 'COPY LINK', visible: has, act: () => this.copyLink() },
        { label: 'SHARE…', visible: () => has() && !!navigator.share, act: () => {
          navigator.share({ title: 'Lode Runner 2099', text: `Beat seed ${this.seed} [${this.diff.toUpperCase()}]`, url: shareUrl(this.seed, this.diff) }).catch(() => {});
        } },
        { label: 'BACK', act: () => this.ui!.back(), cls: 'dim' },
      ],
    };
  }

  private optionsPage(): Page {
    const sm = getSoundManager();
    const cyc = <T>(list: T[], cur: T, d: number): T => list[(list.indexOf(cur) + d + list.length) % list.length];
    const themes = Object.keys(THEMES);
    const idle = [0, 2, 5, 10, 15, 30];
    const tvMode = isTV();
    return {
      title: 'OPTIONS',
      items: [
        { label: 'MUSIC', value: () => ({ procedural: 'SYNTH', radio: 'RADIO PARADISE', soma: 'SOMA SPACE STATION', off: 'OFF' } as any)[sm.getMusicMode()],
          cycle: d => sm.setMusicMode(cyc(['procedural', 'radio', 'soma', 'off'] as const as any[], sm.getMusicMode(), d)) },
        { label: 'SOUND FX', value: () => (sm.isEnabled() ? 'ON' : 'OFF'), cycle: () => { sm.toggle(); } },
        { label: 'THEME', value: () => THEMES[Settings.theme].name?.toUpperCase?.() ?? Settings.theme.toUpperCase(),
          cycle: d => { Settings.theme = cyc(themes, Settings.theme, d); } },
        { label: 'CRT EFFECT', value: () => (Settings.crt ? 'ON' : 'OFF'), cycle: () => { Settings.crt = !Settings.crt; } },
        { label: 'GAME SPEED', value: () => `${CONFIG.SPEED_MULTIPLIERS[Settings.speedIndex]}×`,
          cycle: d => { Settings.speedIndex = Math.max(0, Math.min(CONFIG.SPEED_MULTIPLIERS.length - 1, Settings.speedIndex + d)); } },
        { label: 'REDUCED MOTION', value: () => Settings.reducedMotion.toUpperCase(),
          cycle: d => { Settings.reducedMotion = cyc(['auto', 'on', 'off'] as const as any[], Settings.reducedMotion, d); } },
        { label: 'IDLE SCREEN', visible: () => tvMode, value: () => (Settings.idleMinutes ? `${Settings.idleMinutes} MIN` : 'OFF'),
          cycle: d => { Settings.idleMinutes = cyc(idle, idle.includes(Settings.idleMinutes) ? Settings.idleMinutes : 5, d); } },
        { label: 'RADIO WHEN IDLE', visible: () => tvMode, value: () => ({ off: 'OFF', rp: 'RADIO PARADISE', soma: 'SOMA SPACE STATION' } as Record<string, string>)[Settings.idleRadio],
          cycle: (d: number) => { const a = ['off', 'rp', 'soma'] as const; Settings.idleRadio = a[(a.indexOf(Settings.idleRadio) + (d || 1) + 3) % 3]; } },
        { label: 'CONTROLS', act: () => this.ui!.push(this.controlsPage()) },
        { label: 'BACK', act: () => this.ui!.back(), cls: 'dim' },
      ],
    };
  }

  private controlsPage(): Page {
    const rows = [
      ['MOVE', 'ARROWS / WASD · D-PAD · STICK'], ['DIG LEFT / RIGHT', 'Z X · Q E · A B · ⏪ ⏩'],
      ['PAUSE', 'P · START · ⏯'], ['MENU', 'ESC ×2 · BACK'], ['SPEED', '+ / −'], ['THEME · CRT', 'T · C'],
      ['MUTE · MUSIC', 'M · B'], ['PHONE PAD', 'TV MENU → PAIR'],
    ];
    return {
      title: 'CONTROLS',
      body: `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td class="n">${b}</td></tr>`).join('')}</table>`,
      items: [{ label: 'BACK', act: () => this.ui!.back(), cls: 'dim' }],
    };
  }

  private tvPage(): Page {
    const o = location.origin, tvUrl = `${o}/tv`, apk = `${o}/app`;
    const copy = (u: string) => () => {
      const ok = () => this.ui?.toast('COPIED');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(u).then(ok, () => this.ui?.toast(u, 6000));
      else this.ui?.toast(u, 6000);
    };
    const body = `<b>Smart TV browser:</b> open <code>${tvUrl}</code><br><br>`
      + `<b>Android / Google TV</b> (e.g. Onn 4K): download the app from <code>${apk}</code> `
      + `(sideload with the Downloader app, or a USB stick).<br><br>`
      + `Then scan the QR code on the TV with this phone to use it as a controller.`;
    return { title: 'PLAY ON TV', body, items: [
      { label: 'COPY TV LINK', act: copy(tvUrl) },
      { label: 'COPY APP LINK', act: copy(apk) },
      { label: 'BACK', act: () => this.ui!.back(), cls: 'dim' },
    ] };
  }

  private scoresPage(): Page {
    const s = getHighScores().getScores();
    const esc = (t: string) => t.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);
    const body = s.length
      ? `<table>${s.map((e, i) => `<tr><td>${i + 1}.</td><td>${esc(e.name)}</td><td class="n">${e.score}</td><td>L${e.level}</td><td>${e.difficulty.slice(0, 3).toUpperCase()}</td></tr>`).join('')}</table>`
      : 'No scores yet — go set one!';
    return { title: 'HIGH SCORES', body, items: [{ label: 'BACK', act: () => this.ui!.back(), cls: 'dim' }] };
  }

  private install(): void {
    if (canInstall()) { void promptInstall(); return; }
    this.ui!.push({
      title: 'INSTALL',
      body: 'On iPhone / iPad: tap <b>Share</b> <span style="font-size:1.3em">⎙</span><br>then <b>Add to Home Screen</b>.',
      items: [{ label: 'OK', act: () => this.ui!.back() }],
    });
  }

  private copyLink(): void {
    const url = shareUrl(this.seed, this.diff);
    const ok = () => this.ui?.toast('LINK COPIED');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(ok, () => this.ui?.toast(url, 5000));
    else this.ui?.toast(url, 5000);
  }

  private renderPairing(el: HTMLElement, tv: TVPairing, big: boolean): void {
    const slot = (n: number) => {
      const p = tv.pads.find(x => x.slot === n);
      const name = p ? p.name.replace(/[<>&"]/g, '') : '— EMPTY —';
      return `<div class="slot p${n}${p ? ' on' : ''}"><b>P${n}</b>${name}</div>`;
    };
    const spect = tv.pads.filter(p => p.slot > 2).length;
    el.innerHTML = tv.code
      ? `<div>SCAN TO USE YOUR PHONE</div><img class="qr${big ? ' big' : ''}" alt="" src="${tv.qrImageUrl()}">
         <div class="url">${location.host}/pad</div><div class="code">${tv.code}</div>
         <div class="slots">${slot(1)}${slot(2)}</div>${spect ? `<div class="url">+${spect} watching</div>` : ''}`
      : `<div>${tv.connected ? '' : 'CONNECTING…'}</div>`;
  }

  // ---------------- start ----------------
  private start(mode: Mode, difficulty: string, seed?: string): void {
    if (this.starting) return;
    this.starting = true;
    const s = (seed || generateSeedCode()).toUpperCase().replace(SEED_RE, '').slice(0, 8) || generateSeedCode();
    Settings.lastSeed = s;
    this.diff = difficulty;
    try { localStorage.setItem('lr2099.diff', difficulty); } catch { /* ignore */ }
    getSoundManager().resume();
    getSoundManager().stopMusic();
    this.ui?.root.style.setProperty('transition', 'opacity .25s');
    if (this.ui) this.ui.root.style.opacity = '0';
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.time.delayedCall(260, () => this.scene.start('GameScene', { difficulty, seed: s, mode, tv: isTV() }));
  }

  /** ?seed=XXX&diff=normal[&mode=coop|versus][&p=2] starts that game once per page load. */
  private deepLink(): boolean {
    if (deepLinkDone) return false;
    deepLinkDone = true;
    const q = new URLSearchParams(location.search);
    const seed = q.get('seed'), diff = q.get('diff') ?? 'normal';
    if (!seed) return false;
    const m = q.get('mode');
    const mode: Mode = m === 'coop' || m === 'versus' ? m : q.get('p') === '2' ? 'coop' : 'single';
    this.start(mode, DIFFICULTIES[diff] ? diff : 'normal', seed);
    return true;
  }
}
