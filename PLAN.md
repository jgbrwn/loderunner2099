# 🎮 LODE RUNNER 2099 - Development Plan

## Vision
A web-based Lode Runner with **procedurally-generated solvable levels**, retro-futuristic aesthetics, and the tight gameplay of the C64 original.

---

## 🔬 Reference Analysis (from C64 reverse-engineering)

### Original Tile Types
```
0x00 = Empty
0x01 = Soft Brick (diggable)
0x02 = Hard Brick (indestructible)
0x03 = Ladder
0x04 = Pole/Bar (horizontal traverse)
0x05 = Trap Brick (looks like brick, falls through)
0x06 = Exit Ladder (hidden until all gold collected)
0x07 = Gold
0x08 = Enemy
0x09 = Player (Lode Runner)
```

### Core Mechanics
- **Grid**: 28 columns × 16 rows (original)
- **Movement**: Walk, climb, fall, traverse bars
- **Digging**: Z (dig left), X (dig right) - creates temporary holes in soft bricks
- **Holes**: Auto-refill after ~10 seconds; enemies trapped drop gold
- **Win Condition**: Collect all gold, reach top of level via exit ladders
- **Enemy AI**: Chase player, can climb ladders, fall in holes, respawn at top

---

## 🛠️ Tech Stack Recommendation

### Option A: **Phaser 3** ⭐ RECOMMENDED
| Pros | Cons |
|------|------|
| Mature, battle-tested | Slightly larger bundle (~1MB) |
| Built-in tilemap support | Learning curve for advanced features |
| Great sprite/animation system | |
| TypeScript support | |
| Excellent for retro pixel games | |
| Large community + docs | |

### Option B: **Kaboom.js**
| Pros | Cons |
|------|------|
| Super simple API | Less mature |
| Small bundle size | Fewer advanced features |
| Fun, retro-focused | Smaller community |

### Option C: **PixiJS + Custom**
| Pros | Cons |
|------|------|
| Fastest rendering | Need to build game logic from scratch |
| Maximum control | More code to write |
| Tiny core | |

### Option D: **Pure Canvas**
| Pros | Cons |
|------|------|
| Zero dependencies | Everything manual |
| Smallest possible bundle | Time-consuming |
| Full control | |

### **RECOMMENDATION: Phaser 3 with TypeScript**
- Perfect for tile-based games
- Handles sprites, input, sound well
- Good procedural generation ecosystem
- Professional quality result

### Backend
**Not required for MVP** - everything runs client-side:
- Procedural generation via seeded random (shareable level codes)
- Local storage for settings/high scores

**Future consideration**: Optional backend for leaderboards, level sharing

---

## 🎲 Procedural Level Generation Strategy

### The Challenge
Lode Runner levels must be **solvable** - all gold must be reachable and collectable while avoiding/trapping enemies.

### Multi-Phase Generation Approach

#### Phase 1: Structure Generation
```
1. Create base terrain (platforms at various heights)
2. Add ladders connecting platforms (ensuring vertical connectivity)
3. Add poles/bars for horizontal traversal
4. Place hard bricks as obstacles/boundaries
```

#### Phase 2: Gold Placement + Validation
```
1. Place gold in potentially interesting locations
2. Run reachability analysis (BFS/flood fill)
3. Ensure ALL gold is reachable from spawn
4. Ensure exit (top of map) is reachable after collecting gold
```

#### Phase 3: Enemy Placement
```
1. Place enemies based on difficulty
2. Ensure enemies don't make level instantly fatal
3. Ensure trapping mechanics are possible (nearby diggable bricks)
```

#### Phase 4: Solvability Verification
```
1. Simulate "perfect play" pathfinding
2. Verify gold can be collected in SOME order
3. If fails, regenerate or fix
```

### Solvability Algorithm (Key Innovation)
```typescript
function isSolvable(level: Level): boolean {
  // Build traversal graph considering:
  // - Walking on solid ground
  // - Climbing ladders
  // - Traversing poles
  // - Falling through empty space
  // - Digging to create temporary paths
  
  // Use A*/BFS to verify:
  // 1. All gold positions reachable from spawn
  // 2. Exit reachable after collecting gold
  // 3. At least one valid collection order exists
}
```

### Difficulty Tiers

| Difficulty | Enemies | Gold | Platform Complexity | Trap Bricks | Time Pressure |
|------------|---------|------|--------------------|--------------|--------------|
| **Easy** | 1-2 | 5-8 | Simple, many ladders | Few | Low |
| **Normal** | 2-3 | 8-12 | Moderate | Some | Medium |
| **Hard** | 3-4 | 12-16 | Complex, sparse ladders | Many | High |
| **Ninja** | 4-5 | 16-20 | Extreme, puzzle-like | Everywhere | Extreme |

---

## 🎨 Visual Design: Retro-Futuristic

### Aesthetic Concept: "Cyberpunk Atari"
- Pixel art at authentic retro resolution (scaled up crisp)
- Scanline effects (optional, toggleable)
- Neon glow effects on collectibles/UI
- CRT curvature effect (subtle, optional)
- Dark backgrounds with bright accent colors

### Color Themes
```
🔵 CYBER BLUE (default)
   - Dark blue/black background
   - Cyan ladders, pink/magenta gold
   - White player, red enemies

🟢 MATRIX GREEN
   - Black background
   - Green monochrome with brightness variations
   - Phosphor glow effect

🟠 SUNSET CHROME
   - Dark purple background
   - Orange/yellow gradients
   - Chrome/silver metallic accents

🔴 NEON NOIR
   - Pure black background
   - Hot pink and electric blue
   - High contrast, minimal

⚪ CLASSIC (C64 tribute)
   - Original color palette
   - Authentic retro feel
```

### UI Elements
- Score display with "futuristic" font (e.g., Chicago, Orbitron)
- Level indicator: "LVL-2099-A7X3" style
- Lives shown as small player icons
- Speed indicator (1x, 2x, etc.)
- Difficulty badge

---

## ⌨️ Controls

### Gameplay
| Key | Action |
|-----|--------|
| ← ↑ → ↓ | Move |
| Z | Dig Left |
| X | Dig Right |

### System
| Key | Action |
|-----|--------|
| P | Pause |
| R | Restart Level |
| N | New Random Level |
| - / + | Speed Down/Up |
| T | Cycle Theme |
| M | Mute Sound |
| ESC | Back to Menu |
| F | Fullscreen Toggle |

---

## 📁 Project Structure

```
loderunner2099/
├── src/
│   ├── main.ts              # Entry point
│   ├── config.ts            # Game configuration
│   ├── scenes/
│   │   ├── BootScene.ts     # Asset loading
│   │   ├── MenuScene.ts     # Title/difficulty select
│   │   ├── GameScene.ts     # Main gameplay
│   │   └── GameOverScene.ts # Score display
│   ├── entities/
│   │   ├── Player.ts        # Lode Runner character
│   │   ├── Enemy.ts         # Guard AI
│   │   └── Gold.ts          # Collectible
│   ├── level/
│   │   ├── LevelGenerator.ts    # Procedural generation
│   │   ├── SolvabilityChecker.ts # Validation
│   │   ├── TileMap.ts           # Level data structure
│   │   └── DifficultyConfig.ts  # Difficulty parameters
│   ├── systems/
│   │   ├── PhysicsSystem.ts     # Movement, falling, collision
│   │   ├── DiggingSystem.ts     # Brick destruction/regen
│   │   └── AISystem.ts          # Enemy pathfinding
│   ├── ui/
│   │   ├── HUD.ts               # Score, lives, level
│   │   └── ThemeManager.ts      # Visual themes
│   ├── audio/
│   │   └── SoundManager.ts      # Retro sound effects
│   └── utils/
│       ├── SeededRandom.ts      # Reproducible levels
│       └── Pathfinding.ts       # A* for validation
├── assets/
│   ├── sprites/             # Pixel art
│   ├── audio/               # Sound effects
│   └── fonts/               # Retro fonts
├── public/
│   └── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🚀 Development Phases

### Phase 1: Foundation (MVP) ✅ COMPLETE
1. ✅ Project setup (Vite + Phaser + TypeScript)
2. ✅ Basic tile rendering
3. ✅ Player movement (walk, climb, fall)
4. ✅ Digging mechanics
5. ✅ Simple hand-crafted test level
6. ✅ Gold collection
7. ✅ Win/lose conditions

### Phase 2: Procedural Generation ✅ COMPLETE
1. ✅ Level generator skeleton
2. ✅ Platform/ladder placement algorithms
3. ✅ Gold placement with reachability check
4. ✅ Solvability verification (BFS-based)
5. ✅ Difficulty tiers implementation (4 levels)
6. ✅ Seeded random for reproducibility

### Phase 3: Polish & Enemies ✅ COMPLETE
1. ✅ Enemy AI (pathfinding, hole trapping)
2. ✅ Enemy respawn mechanics
3. ✅ Speed controls (+/- keys, 6 speeds)
4. ✅ Sound effects (Web Audio procedural)
5. ✅ Visual themes (5 themes: Cyber, Matrix, Sunset, Neon, Classic)
6. ✅ Pixel art sprites with animation frames
7. ✅ CRT scanline overlay effect

### Phase 4: Production Ready ✅ COMPLETE
1. ✅ Menu system (difficulty selection, seed input)
2. ✅ High scores (localStorage persistence)
3. ✅ Mobile touch controls (virtual d-pad + dig buttons)
4. ✅ Theme switching (T key)
5. ⬜ PWA support (offline play) - TODO
6. ⬜ Performance optimization - ongoing

### Phase 5: Future Enhancements
1. ⬜ Improved procedural generation variety
2. ⬜ Level editor
3. ⬜ Online leaderboards
4. ⬜ More animations (climbing, hanging detail)
5. ⬜ Music/ambient audio
6. ⬜ Achievement system

---

## 🎯 Success Criteria

1. **Gameplay**: Feels as tight as the original
2. **Generation**: 100% solvable levels, good variety
3. **Performance**: 60 FPS on modest hardware
4. **Aesthetics**: Looks great, themes work well
5. **Accessibility**: Easy to pick up and play

---

## 🤔 Open Questions

1. **Level size**: Keep original 28×16 or modernize?
2. **Aspect ratio**: 4:3 authentic vs 16:9 modern?
3. **Level codes**: Share via URL hash? `#seed=ABC123&diff=hard`
4. **Endless mode**: Infinite procedural levels with increasing difficulty?
5. **High scores**: Local only or online leaderboard?

---

## Next Steps

1. **Your approval** on tech stack (Phaser 3?)
2. **Your preference** on open questions above
3. **Begin Phase 1** implementation

Ready to build! 🕹️
