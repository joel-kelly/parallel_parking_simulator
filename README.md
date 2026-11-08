# Parallel Parking Simulator

*Episode One: Curb Your Enthusiasm.*

A cheeky 3D parallel parking game for the browser, rendered in chunky pixels
with an EGA-era shareware look.

**Play it:** https://joel-kelly.github.io/parallel_parking_simulator/

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).
`npm run build` makes a static build in `dist/` that works from any folder.

Pushes deploy automatically to GitHub Pages via `.github/workflows/deploy.yml`
(it runs the tests first). Pages must use **GitHub Actions** as its source:
Settings → Pages → Build and deployment → Source.

## Controls

| Key | Action |
| --- | --- |
| W / Up | Gas (or brake, if rolling backward) |
| S / Down | Brake, then reverse |
| A D / Left Right | Steer |
| Space | Handbrake |
| C | Cycle camera: chase, high chase, top-down |
| H | Horn (each vehicle has its own) |
| R | Restart |
| Esc | Pause |
| I | Let the instructor park for you (Driving Test only, no points) |
| Enter | Cash out (Wreck mode) |
| M / P | Mute / switch between modern and classic EGA colours |

No gear shifting: stop, keep holding S, and the car goes into reverse.

## Modes

- **Tutorial**: a one-minute guided intro to the controls, ending with your first
  park. It runs automatically the first time you start any mode (Enter skips it)
  and can be replayed from the menu.

- **Driving Test**: park between two cars and get graded (S to F) on moves vs. par,
  dings, distance from the curb, angle, centering, time and vandalism.
  Par comes from the AI planner's own best solution for that spot.
- **Race the AI**: you and an AI each have a spot on opposite sides of the street.
  First one parked wins. The AI gets better (and ruder) with difficulty.
- **Wreck-reation**: everything breaks. Hydrants geyser, parking meters spill
  coins, trees and lamp posts topple, parked cars eventually explode. Ram a shop
  to smash its front; keep ramming and the whole building collapses into rubble
  you can drive through. At the far end is a ramp: hit it straight and you get
  big air, catch the side or come down wrong and you flip, which ends the run
  (your claim is filed from the roof). Press Enter to file the insurance claim.

**Difficulty** sets how much spare room the spot has beyond your car's length:
Easy +3.0m, Normal +2.0m, Hard +1.45m, Insane +1.15m. Hard and Insane need
back-and-forth shuffles.

**Garage**: the Bean and the Za Wagon are free; points unlock Mr. Scoops,
Ground Pounder, Stretch Prince (a limo, good luck) and The Weenie. Press C in the
garage to open the **paint shop** and pick body and stripe colours from the EGA
palette. Progress and paint jobs are saved in the browser.

## Code layout

- `src/sim/`: game logic with no graphics, so it runs in Node too.
  - `physics.js`: small 2D oriented-box rigid body physics.
  - `vehicles.js`: vehicle specs and the bicycle-model driving.
  - `level.js`: street layout, parked cars, props, difficulty.
  - `world.js`: steps the sim, collisions, dings, curb hops, smashing, park detection.
  - `air.js`: the vertical part: suspension springs, ramp and curb heights,
    jumps, pitch/roll and flip detection, layered on the flat 2D sim.
  - `ai.js`: parking planner + driver (used by the race AI and the instructor demo).
  - `grading.js`: scores and instructor quips.
- `src/render/`: Three.js view, blocky models, debris/particles, and the
  post-process (low-res render, outlines, colour grade). `looks.js` holds the
  two colour styles: modern (default) and classic 64-colour EGA dithering.
  Everything is authored in EGA colours and remapped for the modern look.
- `src/main.js`: menus, HUD, modes, progression. `src/audio.js`: synthesized sounds.

## Tests

```bash
npm test
```

Runs the AI on every vehicle at every difficulty and checks it parks with no dings
and within par. If the AI can do it, the spot is fair for a human.
