# Lode Runner 2099 — Overhaul Plan (Nov 2026)

Fresh review of the codebase (~7.3k lines TS, Phaser 3.90, Vite, tiny Go static server).
Ordered for value per dollar; each phase ships something playable.

---

## 1. Review findings

### Gameplay fidelity (vs. classic Lode Runner)
| # | Finding | Where |
|---|---------|-------|
| G1 | **Guards fall through holes** dug in a single-thickness (elevated) floor. In `Enemy.update` the "trapped" check is skipped while `FALLING`, and `shouldFall()` keeps going if the cell under the hole is empty. Classic: a guard entering a hole is **always** held there. (Player falling through a hole with nothing under it is classic behaviour.) | `Enemy.ts` |
| G2 | Guard AI is a greedy 4-direction scorer + 20% `Math.random()`: jitters, gets stuck, not seeded/deterministic. Classic uses Doug Smith's row-scan algorithm (scan left/right for ladders/drops leading toward the player's row). | `Enemy.chooseMove` |
| G3 | Movement is tile-locked: no reversal mid-tile, no input buffering for turning onto ladders; guards tick on a 100 ms timer. Stiffer than the original's sub-tile stepping. | `Player.update` |
| G4 | Variable-delta sim (no fixed timestep); hitches can skip logic. | all entities |
| G5 | Guards only drop gold when trapped; classic guards also drop it at random. Classic scoring/lives (gold 250, trap 75, kill 75, clear 1500, +1 life/level) not fully mirrored. | `Enemy`, `GameScene` |
| G6 | Guard climbing out doesn't steer toward player; dig rules with guard/gold on top, trap-brick behaviour, guard stacking need verification. | `Enemy`, `TileMap.canDig` |

### Procedural generation / solvability
| # | Finding |
|---|---------|
| P1 | **Solvability is one-way reachability** from the start. Gold reachable only via a one-way drop/dig with no way back still passes → possible soft-locks. Needs a *round-trip* proof: condense the move graph into SCCs, require a DAG path start → every gold SCC → exit. |
| P2 | Doesn't model "dug into a pit and the hole refills on you" death traps. |
| P3 | **Enemy-assisted gold** relies on random guard AI delivering it: not guaranteed. Make it deterministic (new AI + sim) or drop it. |
| P4 | Generator = random scatter + rejection (up to 700 attempts) + hard-coded fallback level. Visible artifacts (see screenshot): rows of 1-tile ladder stubs used as floors, floating fragments, sparse layouts. Reachability code duplicated in generator and checker. |
| P5 | No headless harness: no stats on solve rate, gen time, fallback rate. |

### Tech / architecture
| # | Finding |
|---|---------|
| T1 | "Return to menu" is a **page reload** (`window.location.replace`), a workaround for scene-lifecycle bugs (likely the Firefox hang: leaked window listeners, `setTimeout` music loop, AudioContext). Fix properly. |
| T2 | Music scheduled with `setTimeout` loops: drift, gaps, background-tab throttling. |
| T3 | Logic, rendering, input, audio tangled in `GameScene` (1150 lines). |
| T4 | Phaser 3.90 → **Phaser 4.2.1** available. Mostly compatible; CRT effect must move to Phaser 4 Filters. |
| T5 | Touch controls overlay the playfield. No PWA/service worker, no gamepad support. |

### Music
3 raw oscillators, one 8-bar loop forever, no drums, no song form, no FX, no reaction to gameplay.

### Graphics / UI
Clean but basic: 24 px canvas-drawn tiles, minimal animation frames, plain text HUD and menu.

---

## 2. Target architecture

```
src/
  sim/       Pure TS, no Phaser. Fixed 60 Hz tick, seeded RNG, deterministic.
  level/     generator v2 + solver (SCC round-trip) + level metrics
  input/     InputManager: keyboard | gamepad | touch | TV remote | phone-pad (WS)
  audio/     lookahead scheduler, synth voices, composer v2, SFX, radio (TV idle)
  render/    Phaser 4 scenes that *draw* the sim: tiles, sprites, particles, filters
  ui/        menus (desktop/mobile/TV), HUD, splash, idle screen
  platform/  PWA, TV mode, Android-TV bridge, pairing
server/      Go: static+caching, WebSocket pairing rooms, QR, Radio Paradise now-playing proxy
android/     WebView wrapper (woogles-tv approach: no Gradle, build.sh → APK)
tools/       headless level-stats + bot-solver CLI
```

Pure deterministic sim → headless tests, replays and attract-mode demos for free, identical behaviour on
phone/TV/desktop, and gameplay isolated from engine upgrades.

---

## 3. Phases

### Phase 1 — Foundation & fidelity
1. Phaser 4 upgrade; remove page-reload hack with proper scene shutdown; verify in headless Firefox.
2. Extract `sim/` (fixed timestep, seeded RNG); port classic guard AI; fix G1, G3, G5, G6.
3. InputManager (keyboard + Gamepad API + D-pad remotes); rebindable keys.
4. Vitest unit tests on the sim.

### Phase 2 — Procedural generation v2
1. Solver: move graph incl. dig transitions → SCC condensation → round-trip proof; death-trap detection.
2. Generator: constructive "idioms" (brick towers, dig-through floors, pole traverses, gold pits needing a dig, trap-brick gotchas, hard-brick vaults) on a connected skeleton, validate, pick best-of-N by a deterministic fun score (path length, required digs, guard pressure, verticality). Remove ladder-stub artifacts and the fallback level.
3. `tools/levelstats`: 10k seeds × 4 difficulties → solve rate, gen time, metrics; bot plays a sample through the sim.
4. Seed sharing kept; URL gains `&g=2` (generator version).

### Phase 3 — Graphics (same aesthetic, much more detail)
- 32 px logical tiles, 960×540 base (exact 2× for 1080p, 4× for 4K), integer scaling.
- Code-generated pixel-art sheets: 6-frame run, climb, hang, fall, dig, death; guard variants; per-theme palettes.
- Animated tiles: dig crumble + debris, hole refill phases, gold shimmer, exit-ladder reveal sweep, guard warp-in.
- Subtle procedural parallax skyline per theme; bloom/glow + better CRT (curvature, aberration, vignette).
- New HUD bar (icons, gold pips, lives), level intro/outro transitions, death shake. Reduced-motion option.

### Phase 4 — Music v2
- Lookahead Web Audio scheduler on the audio clock.
- Instruments: duty-cycle pulse (PeriodicWave), triangle bass, noise drums, arps, vibrato, ADSR, delay bus, compressor.
- Composer: song form (intro → A → B → breakdown → A′), motif development, progressions with voice leading, drum library, seeded per-level style (synthwave, chip-house, darkwave…).
- Adaptive: intensity rises as gold runs out / guards close in; "escape" variation when exit appears; in-key stingers. Menu theme.

### Phase 5 — Mobile / PWA
- Manifest, service worker (fully offline), icons, splash screens (Android + iOS), landscape lock.
- Layouts: landscape = controls in side gutters (never over the playfield); portrait = playfield top, pad bottom.
- Big D-pad + optional swipe mode, dig buttons, haptics, size/opacity/left-handed options.

### Phase 6 — TV (/tv + Android TV) & phone controller
- `/tv`: 10-foot UI, overscan-safe, D-pad focus nav, remote keys, splash.
- Pairing: Go WebSocket rooms; TV shows QR + code → phone opens `/pad?room=XXXX` → input relay.
- Idle screen after pause + inactivity: attract-mode bot demo, clock, Radio Paradise stream + now-playing card (reuse woogles-tv `music.go`), drift anti-burn-in.
- Android TV app: woogles-tv's Gradle-less WebView wrapper → `/tv?app=1`, banner; APK served at `/app`.

### Phase 7 — Menus & polish
- Title: animated logo, attract demo behind, Play / Daily Seed / Enter Seed / Options / Scores / How to Play.
- TV variant with QR panel; mobile variant with thumb-sized items.
- Extras: daily seed, share card + copy-link, stats, optional input-replay links.

---

## 4. Budget strategy ($30 API)
Full scope likely exceeds $30, so: Phases 1–2 first (real bugs; everything builds on the sim), then pick.
Work file-by-file, test with headless node scripts over screenshots.
Rough guesses: P1 $5–7 · P2 $5–7 · P3 $5–6 · P4 $3–4 · P5 $3 · P6 $5–6 · P7 $2–3.

## 5. Open questions
1. Old share links: keep v1 generator alive, or let them produce v2 levels?
2. Holes: guards stay in *any* hole; player falls through a hole if empty below (classic). Is that what you meant?
3. Enemy-assisted gold: make deterministic, or drop?
4. Phone controller: single player, or eventually 2-player co-op on TV?
5. Radio Paradise only on the TV idle screen, or also as optional in-game music?

---

## Follow-up: trap bricks true to the original (done: steps 1, 2, 4; trap stays drawn as brick, no reveal)
Original: a trap ("false") brick looks like brick but is **not solid at all** — runners and guards can walk into it
from the side and fall through it from above; it can't be dug and isn't support. Ours currently blocks sideways
movement (solver and sim agree on that rule). To switch:
1. **Sim** (`src/sim`): treat `BRICK_TRAP` like `EMPTY` for movement/support everywhere (players + guard AI path
   scans); not diggable. Render as brick until something passes through, then show it as revealed (faint outline).
2. **Solver** (`src/level/SolvabilityChecker.ts` / `MoveGraph`): `canEnter` allows trap cells; side-entry creates a
   fall edge. Same for guard reachability (affects enemy-assisted gold proofs and `goldDropCells`).
3. **Generator**: keep trap "gotchas" but let the solver veto placements that create death pits; never use a trap as
   the only floor of a required route unless the fall leads somewhere useful.
4. Tests: sim test for side-entry + fall; rerun `tools/levelstats` (must stay 100% solvable, 0 fallbacks) and check
   guard-assisted gold delivery on generated levels. Est. cost ≈ $1–1.5.
