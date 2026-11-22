# Overhaul — shared context for all workers

Read `/home/exedev/loderunner2099/OVERHAUL_PLAN.md` first (findings + phases). This file adds the user's decisions
and cross-team contracts. Repo: /home/exedev/loderunner2099 (Vite + TS + Phaser, Go static server `server.go`).

## User decisions (final)
- Old share links may produce new levels. URL keeps `?seed=XXX&diff=normal`, add `&g=2`.
- Classic fidelity: guards are ALWAYS held in any hole they enter (even with empty space below). The player falls
  through a hole if nothing is below (classic). Make guard AI as true to the original (Doug Smith's algorithm) as
  works with our procedural design.
- Keep "enemy-assisted gold" (gold only reachable via a guard carrying it, more on harder difficulties) but make it
  RELIABLE (deterministic sim + solver/AI guarantee).
- 2-player: same-screen co-op (both on one board) AND split-screen versus (two boards, same seed, race). Plus normal
  single player.
- Music options: procedural (default) | Radio Paradise stream (SFX still play) | off. Radio also on TV idle screen.
- TV at `/tv` + Android TV WebView app (Onn 4K box); phone PWA standalone + phone-as-controller paired by QR.
- Keep the neon retro aesthetic; much more detail/polish.

## Budget — HARD constraint
The user is paying API rates with ~$30 total for the whole overhaul. Be frugal with tokens:
- Read only what you need (grep / sed -n ranges), don't cat big files repeatedly, don't dump large outputs.
- Prefer headless node/vitest/go tests over browser screenshots; at most a few screenshots per phase.
- Don't write long docs. Short commit messages are fine. Final report to the parent: <= 15 lines.

## Git etiquette (several workers may run in parallel)
- Only modify files in your assigned area. Commit with `git add <your paths>` (never `git add -A`), small commits.
- If a commit fails due to index lock, retry after a moment.

## Cross-team contracts
### Audio (src/audio/) — owned by the music worker
`getSoundManager()` singleton keeps its existing SFX methods (playDig, playGold, ... ) and gains:
- `startLevelMusic(seed: string, level: number, difficulty: string)` / `stopMusic()` / `pauseMusic()` / `resumeMusic()`
- `playMenuMusic()`
- `setIntensity(x: number)` 0..1 (gold remaining / guard proximity), `setEscape(on: boolean)` (exit ladders shown)
- `stinger(kind: 'gold'|'death'|'clear'|'trap'|'exit')`
- `setMusicMode(mode: 'procedural'|'radio'|'off')`, `getMusicMode()` (persisted in localStorage), `nowPlaying()`
  returns `{title, artist, coverUrl}|null` in radio mode.
- `toggle()` (all sound) and `toggleMusic()` keep working; `isMusicEnabled()` stays.
Old `playMusic(track)` may remain as a thin shim until scenes migrate.

### Server (Go, repo root) — owned by the server worker
- Static `dist/` with existing cache rules; SPA routes `/tv`, `/pad` serve the corresponding built html
  (Vite multi-page: `index.html`, `tv.html`, `pad.html` — the server worker may create placeholder html entries;
  the frontend workers fill them in later).
- `GET /api/radio/now` → `{title, artist, coverUrl, streamUrl}` (Radio Paradise; cached ~15s).
- `GET /api/qr?text=...` → PNG.
- WebSocket pairing: see `docs/overhaul/PROTOCOL.md` (server worker writes it; keep it short).
- `/app` serves the Android APK if present.

### Input (src/input/) — owned by the Phase 1 worker
`InputManager` producing per-player action state `{left,right,up,down,digLeft,digRight,pause,back,confirm}` from
keyboard, Gamepad API, touch, TV remote and remote phone pads (`RemotePadSource` fed by WebSocket messages).

## Later user decisions (TV/pad/fullscreen)
- Audio in TV mode plays on the TV only. /pad is silent by default (haptics on); pad settings offer "Sound on phone" (SFX)
  as an opt-in override.
- Pairing persists: the TV keeps a stable room code across app restarts (TV stores a secret token in localStorage; server
  re-issues the same code to that token; if the code is taken or the server restarted, it gets a new one and the
  QR updates). Phones remember last TV code + their id and auto-rejoin when /pad opens. TV menu: "Pair a controller"
  (shows QR/code), "Disconnect controllers" (kicks pads), "New pairing code" (rotates code). Phone: "Switch TV".
- Fullscreen toggle (Fullscreen API) on desktop/mobile browsers when not already standalone; hide where unsupported
  (iPhone Safari). /pad requests fullscreen + wake lock on first tap. /tv in a TV browser: prompt OK to go fullscreen;
  in the Android app it is already fullscreen.
- Final phases if credits allow: security pass, then update the public repo (README, docs, screenshots).
