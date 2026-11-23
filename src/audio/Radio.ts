export interface NowPlaying { title: string; artist: string; coverUrl: string }

const SOMA_STREAM = 'https://ice2.somafm.com/spacestation-128-aac';
export type Station = 'rp' | 'soma';
const FALLBACK_STREAM = 'https://stream.radioparadise.com/aac-128';
const POLL_MS = 20000;

/** Radio Paradise via <audio>; now-playing polled from /api/radio/now while active. */
export class RadioPlayer {
  private audio: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private info: NowPlaying | null = null;
  private streamUrl: string | null = null;
  private active = false;

  private station: Station = 'rp';

  async start(volume: number, station: Station = 'rp'): Promise<void> {
    if (this.active && this.station === station) { this.setVolume(volume); this.tryPlay(); return; }
    if (this.active) this.stop();
    this.station = station;
    this.active = true;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'none';
    }
    this.setVolume(volume);
    if (station === 'soma') this.info = { title: 'Space Station Soma', artist: 'SomaFM', coverUrl: '' };
    await this.poll();
    if (!this.active) return;
    const url = station === 'soma' ? SOMA_STREAM : (this.streamUrl || FALLBACK_STREAM);
    if (this.audio.src !== url) this.audio.src = url;
    this.tryPlay();
    if (this.timer === null) this.timer = setInterval(() => { void this.poll(); }, POLL_MS);
  }

  /** Call from a user gesture if autoplay was blocked. */
  tryPlay(): void {
    if (this.active && this.audio && this.audio.paused) this.audio.play().catch(() => { /* needs gesture */ });
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load(); // drop the network stream
    }
  }

  setVolume(v: number): void { if (this.audio) this.audio.volume = Math.max(0, Math.min(1, v)); }
  isActive(): boolean { return this.active; }
  nowPlaying(): NowPlaying | null { return this.active ? this.info : null; }

  private async poll(): Promise<void> {
    try {
      const r = await fetch(this.station === 'soma' ? '/api/radio/soma' : '/api/radio/now', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j === 'object') {
        this.info = { title: String(j.title ?? ''), artist: String(j.artist ?? ''), coverUrl: String(j.coverUrl ?? '') };
        if (this.station === 'rp' && typeof j.streamUrl === 'string' && j.streamUrl) this.streamUrl = j.streamUrl;
      }
    } catch { /* endpoint missing: keep fallback */ }
  }
}
