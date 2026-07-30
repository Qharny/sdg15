# 🌍 Guardians of the Land

**A 3D browser game about SDG 15 — Life on Land.**

A valley is dying. Desertification is creeping in from the west, loggers are stripping the last stands of forest, poachers are after what wildlife remains, and wildfires can flare up in a drought. You're the ranger on the ground — plant, irrigate, and defend your way to a restored ecosystem before degradation wins.

Built with nothing but plain HTML, CSS, and JavaScript ES modules, rendered with [three.js](https://threejs.org/). No build step, no bundler, no game engine license — open `index.html` behind a static server and you're in the valley.

![status](https://img.shields.io/badge/status-playable-4f9d3f) ![stack](https://img.shields.io/badge/stack-three.js%20%2B%20vanilla%20JS-2c6e2f) ![sdg](https://img.shields.io/badge/SDG-15%20Life%20on%20Land-1f6b2c)

---

## 🎮 Play

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Look around | Mouse (click to lock pointer) |
| Plant a tree or shrub | `E` |
| Switch tree / shrub | `Tab` |
| Irrigate land / douse a fire | `Q` |
| Shoot loggers &amp; poachers | Click or `F` |
| Open the field manual | `H` |
| Pause | `Esc` |

Never played? Press `H` anytime (or the "How to Play" button on the start/pause screens) for the in-game field manual — it covers the objective, mechanics, and a few tips without leaving the browser.

**Win condition:** push forest cover and the biodiversity index to your level's targets (up to **55%** each on Hard), and the ecosystem is officially restored. Clearing all three story levels unlocks **Endless Vigil** — no win condition, just an increasingly hostile valley and a best-survival-days record.

## 🌱 How the world actually works

Nothing here is scripted set-dressing — it's a live simulation running on a health grid under the hood:

- **Every cell of land has a health value from 0 (bare desert) to 1 (mature forest).** Cell color, ground decor, and gameplay all read from that same number.
- **Trees raise the health of the ground they're planted on**; bare, untended ground slowly degrades. Plant nothing, and the valley drifts toward desert on its own.
- **Desertification spreads.** Cells below the desert threshold periodically erode a neighboring cell's health — a real feedback loop, not a fixed animation, so left unchecked the sand genuinely creeps outward.
- **Loggers path toward the healthiest trees, camp out, and chop.** A visible progress bar hovers over their head while they work — get there and hit `F` before it fills, or the tree (and a chunk of that cell's health) is gone.
- **Animals only spawn once there's a mature forest to support them**, wander near their home grove, and flee (then despawn) if the land around them degrades or a logger gets too close. The biodiversity index is a direct read of how many are alive.
- **Ground decor reacts to restoration in real time** — grass tufts fade in as land recovers past the grass threshold, sparse rocks appear as it crosses into desert. You can watch the valley visually heal or decay, cell by cell.
- **Seeds and water are limited, regenerating resources** (a nursery restocks seeds slowly; a canteen refills over time), so restoration is paced — you can't just carpet the map instantly.
- **Two things to plant, one real currency**: trees grow slowly into true forest cover and animal habitat; shrubs (`Tab` to switch) are a cheap, fast-growing stopgap that holds land above desert level but deliberately caps out below "mature forest" — useful for firewalling the desert edge while your real trees mature.
- **Poachers hunt your wildlife** the same way loggers hunt your trees — they path toward a live animal, try to net it, and can be scared off with a well-aimed seed-pod before the net closes.
- **Wildfires** can ignite on dry, mature trees (far more likely during a drought), burn down their host cell and its tree, and spread to flammable neighbors — put them out with the same irrigate action (`Q`) you use to water land.
- **Weather and seasons compound**: short-term weather (clear/rain/drought) and the long-term season both scale growth, decay, desertification speed, and fire risk, shown together in the HUD.
- **Mountains, a lake, and the rivers connecting them** are permanent terrain features, not part of the health simulation — they block planting and movement, and land near the water heals faster and decays slower than land out in the open.

## ✨ Presentation details

- **One continuous, smoothly-shaded terrain mesh** — vertices sit exactly on the health grid and interpolate color/lighting across each quad, so the ground reads as rolling hills rather than a tiled checkerboard.
- **Organic trees**: each one is built from a randomized cluster of 2–3 overlapping canopy lobes plus a tilted trunk, with a continuous wind-sway animation — no two trees are identical, and none of them are a perfect cone.
- **A real day/night cycle**: a shader-driven sky dome gradient (horizon → zenith) and a sun sprite track a moving directional light, with shadows, ambient light, and fog color all shifting together.
- **First-person head-bob and a subtle FOV kick** while walking, for a bit of physicality instead of a static gliding camera.
- **Fully procedural, synthesized audio** — ambient wind, footsteps, a planting chime, and a logger alert tone are all generated at runtime with the Web Audio API. No audio files are shipped or fetched.
- **Toasts cycle real SDG 15 facts** as in-game days pass, tying the mechanics back to the actual goal.
- **A live minimap** in the HUD corner mirrors the health grid from above, with your position/facing and red/orange/yellow blips for loggers, poachers, and active fires.
- **Cross-playthrough achievements** (cumulative planting, threats stopped, fires doused, levels cleared, Endless survival, and more) unlock as toasts — no separate screen to check.
- **Best-time persistence**: your fastest clear (in in-game days) per level, and your longest Endless survival, are remembered locally and shown on the level-select screen.

## 🗂️ Project structure

```
index.html          Markup, HUD layout, start/pause/victory overlays, import map
style.css            All visual styling (HUD, overlays, toasts)
js/
  utils.js           Shared math + the base ground-bump function every system agrees on
  worldgen.js        One-time generation of mountains, the lake, and the rivers connecting them
  terrain.js         Health grid, smooth terrain mesh, desertification spread, grass/rock/water decor
  trees.js           Tree/shrub planting, growth, organic canopy geometry, wind sway
  animals.js         Wildlife spawn/wander/flee logic and the biodiversity index
  loggers.js         Logger AI: seek → chop → retreat state machine
  poachers.js        Poacher AI: seek → capture → retreat, targeting live animals instead of trees
  fire.js            Wildfire ignition/spread/burnout, extinguished via the irrigate action
  environment.js     Short-term weather + long-term seasons, combined into growth/decay multipliers
  achievements.js    Cumulative, cross-playthrough achievement tracking (localStorage)
  minimap.js         Canvas-based top-down health-grid minimap with threat blips
  levels.js          Difficulty tuning per level, unlock/pending state, best-result persistence
  chatBubbles.js     DOM speech bubbles for logger/poacher ambient chatter
  projectiles.js     Seed-pod slingshot physics and hit detection against loggers/poachers
  player.js          Pointer-lock controls, movement, head-bob, resources, interactions
  audio.js           Web Audio synthesis (wind, footsteps, chime, alert, fanfare, fire, rain) — no asset files
  ui.js              HUD updates, toasts, SDG 15 facts, start/pause/victory/defeat screens
  main.js            Scene/renderer/lighting setup, sky dome, day/night cycle, game loop
```

## ▶️ Running it locally

Browsers block ES module imports over `file://`, so serve the folder instead:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works — `npx serve`, VS Code's Live Server, etc.

## 🛠️ Tech stack

- Vanilla HTML / CSS / JavaScript (ES modules, no build step)
- [three.js](https://threejs.org/) r160 via CDN import map (`PointerLockControls` from the official addons)
- Web Audio API for all sound
- No frameworks, no bundler, no external textures or audio assets

## 🌍 Why SDG 15

Sustainable Development Goal 15 calls for protecting and restoring terrestrial ecosystems, sustainably managing forests, combating desertification, and halting biodiversity loss. This game doesn't simulate policy — it simulates the *feeling* of the goal: restoration is slow, degradation is fast if ignored, and protecting what you've already rebuilt matters as much as planting something new.
