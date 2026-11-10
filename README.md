# Parallel Parking Simulator

*Episode Two: Curb Your Enthusiasm Harder.*

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
| Shift | Nitro (Wreck-reation only) |
| C | Cycle camera: chase, high chase, top-down |
| H | Horn (each vehicle has its own; hurries jaywalkers along) |
| R | Restart |
| Esc | Pause |
| I | Let the instructor park for you (Driving Test only, no points) |
| Enter | Cash out early (Wreck mode) |
| M / P | Mute / toggle retro colours |

No gear shifting: stop, keep holding S, and the car goes into reverse.

## Modes

- **Career**: 19 hand-made levels, each with its own gimmick, unlocked one after
  another. Earn up to three stars per level (park / score 650 / score 850, or for
  races: win / clean win / clean win under 45s). Some levels lend you a company car.
- **Valet Shift**: endless arcade mode. Every customer hands you a random car (even
  ones you don't own), the spot gets tighter, the clock gets shorter, and hazards
  pile on from customer 3. Clean parks build a streak multiplier. Three strikes
  (a timeout, or three dings in one park) and the shift is over.
- **Daily Dare**: one fixed challenge per day, the same for everyone: a car, a
  spot size and a couple of hazards picked from the date. Your best is saved per day.
- **Free Play**
  - **Driving Test**: park between two cars and get graded (S to F) on moves vs. par,
    dings, distance from the curb, angle, centering, time, vandalism and terrorised
    pedestrians. Par comes from the AI planner's own best solution for that spot.
  - **Race the AI**: you and an AI each have a spot on opposite sides of the street.
    First one parked wins. The AI gets better (and ruder) with difficulty.
  - **Wreck-reation**: two minutes until the cops arrive. Everything breaks: hydrants
    geyser, meters spill coins, trees topple, parked cars explode, shops lose their
    fronts and then collapse. Smash things in quick succession for a combo
    multiplier, hold SHIFT for nitro, and dodge the traffic (or don't). There is a
    statue of the mayor. Press ENTER to file the insurance claim early.
  - **Tutorial**: a one-minute guided intro. Runs automatically the first time.

### Hazards

Career, Valet Shift and the Daily Dare mix these in. Each one active adds 20%
hazard pay to the points.

| Hazard | What it does |
| --- | --- |
| Rush Hour | Traffic in the other lane. They brake for you, then honk at you. |
| Jaywalkers | Pedestrians cross the road and stop to check their phone. Honk (H) to hurry them. They always dive clear, but scares cost points. |
| Downpour | Rain, puddles, half the grip. Thunder. |
| Black Ice | A fifth of the grip. Brake early. |
| Night Shift | Dark street, headlights only, a few working lamp posts. |
| Pea Soup | Thick fog. |
| No Mirrors | Chase camera only. |
| Steering Recall | Left and right are swapped. |
| Stuck Pedal | The car creeps forward on its own. Finish with the handbrake. |
| Creeper | The car in front slowly backs into your spot until it's Insane-sized. |
| Tremors | Periodic earthquakes shuffle the parked cars. |
| Mystery Street | No marker, five gaps of different sizes. Any gap counts; tighter gaps pay a bonus. |

**Difficulty** sets how much spare room the spot has beyond your car's length:
Easy +3.0m, Normal +2.0m, Hard +1.45m, Insane +1.15m. Hard and Insane need
back-and-forth shuffles.

**Garage**: the Bean and the Za Wagon are free; points unlock the Shopping Kart,
Mr. Scoops, Ground Pounder, Stretch Prince (a limo, good luck), The Weenie and
Big Yeller (a school bus, which gets a bus-sized spot). Press C in the garage to
open the **paint shop**. Progress and paint jobs are saved in the browser.

**Trophies**: 32 achievements worth 100 points each, from "park a car" to
"three stars on every Career level". They pop up as toasts when earned.

## Code layout

- `src/sim/`: game logic with no graphics, so it runs in Node too.
  - `physics.js`: small 2D oriented-box rigid body physics.
  - `vehicles.js`: vehicle specs and the bicycle-model driving (grip, nitro).
  - `level.js`: street layout, parked cars, gaps, props, difficulty, hazards.
  - `mods.js`: the hazard definitions.
  - `world.js`: steps the sim, collisions, dings, curb hops, smashing, combos,
    earthquakes, the shrinking spot, park detection.
  - `traffic.js`, `peds.js`: the NPC drivers and pedestrians.
  - `ai.js`: parking planner + driver (used by the race AI and the instructor demo).
  - `grading.js`: scores and instructor quips.
  - `career.js`, `achievements.js`: the level list and the trophies.
- `src/render/`: Three.js view, blocky models, debris/particles, and the retro
  post-process (low-res render, black outlines, 64-colour EGA dithering).
- `src/main.js`: menus, HUD, modes, progression. `src/audio.js`: synthesized sounds.

## Tests

```bash
npm test
```

Runs the AI on every vehicle at every difficulty and checks it parks with no dings
and within par (if the AI can do it, the spot is fair for a human), checks every
Career level is parkable, soaks the traffic and pedestrians for a minute, and
checks the shrinking spot stays parkable.
