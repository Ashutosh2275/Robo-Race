# Robo Race 3D

A browser-based, manually driven tracked-robot race game made with Vite, TypeScript and Three.js. This is an original course informed by the project's university robo-racing reference review; it is not a reproduction of any event's official track. The player directly drives the tracks. There is no line-following gameplay.

## Run locally

Requirements: Node.js 20.19+ or 22.12+ and npm.

```powershell
npm install
npm run dev
```

Open the URL printed by Vite. The current development server is running at **http://localhost:5173/**. If you launch another server and 5173 is occupied, Vite selects another port and prints the correct URL.

For a production build:

```powershell
npm run build
npm run preview
```

## Controls

- **W / S:** forward / reverse.
- **A / D:** turn left / right by changing the left and right track commands.
- **Space:** brake.
- **R:** recover at the start or the last passed gate (adds the configurable recovery penalty).
- **C:** cycle chase, low chase and tactical camera views.
- **F3:** toggle route debug lines and collider bounds.
- **Escape:** pause / resume.
- **Mouse:** drag upward on the left or right half of the 3D view to command that track; release to return it to neutral.
- **Touch:** use the two lower-corner gimbals together. Vertical direction commands each track; horizontal stick movement steers left / right. Brake, pivot, reset, camera and pause controls are available on touch layouts.

Open **Settings** to adjust stick sensitivity, dead zone, collision/recovery penalty, and graphics quality. The penalty is a configurable game setting, not a universal competition rule.

## Project layout

- `src/main.ts` — Three.js arena, modular robot meshes, track surfaces, obstacle course, fixed-step differential controller, collisions, ordered gates, race state, camera, input and HUD.
- `src/style.css` — responsive desktop and landscape touch interface.
- `public/reference-robot.png` — user-provided silhouette and material reference.
- `outputs/university-robo-racing-reference-review.md` — source review and caveats.

## Course and approximations

The authored arena is 38 × 30 m, presented at 1.3× world scale (about 49 × 39 m). Its route follows the supplied overhead composition: upper-left start, five-bar slalom, three speed breakers, curved ramp and elevated bridge across the upper course, marble pit and rotating disc on the right, sand/gravel/turf/rubber patches through the centre, a low-grip metal section at the front, then two hairpins and the finish on the left. Eleven directional gates represent the ordered sections. The course draws on obstacle examples in the research review, but is an original game layout and does not claim to reproduce any university's exact rules or course.

Driving uses a deterministic 120 Hz fixed timestep, differential left/right track commands, custom box collision response, surface-dependent traction and animated tread cleats that travel around the track loop. Route walls are generated from one rounded centreline and matching offset paths; this replaces the previous independent, hand-placed barrier runs that overlapped or crossed the course. The F3 debug view shows the centreline, corridor edges, collision boxes and gate markers. The robot stays predominantly black with a low chassis, exposed dark rollers, red deck switch and upright antenna. The ramp and bridge use visible mesh profiles with an authored height field, slope gravity, traction-limited motor force, rolling resistance, lateral grip and braking. The marble bed uses a textured patch and decorative spheres with reduced traction, rather than individually simulated marbles. The disc applies capped surface-motion force rather than a full rigidbody simulation. Procedural surface textures distinguish sand, gravel, turf, rubber and the slick metal patch. A camera clearance check keeps the view from passing through overhead start/finish structures. The physics prioritize stable, playable handling over engineering-grade robot dynamics.

## Verification completed

- `npm run build` passes TypeScript checking and creates the Vite production bundle.
- `npm test` passes seven focused fixed-step tests, including A-left/D-right mapping and a responsive turning arc under throttle.
- Opened the local game in Chrome and confirmed the Three.js scene, robot, 11-gate HUD and start menu render.
- Started a race and used W, then A: the robot moved at about 5 m/s and advanced through gates 1–3 in sequence. The speed and gate HUDs updated during the drive.
- Paused the race and used **Restart Race**: the timer and gate count returned to zero and the three-second countdown restarted.
- Rebuilt after adjusting the course layout, bridge ramp mesh and camera clearance around the gantries. No browser console errors appeared in the inspected reload.
- The finish trigger requires all 11 ordered gates and then a westbound crossing of the finish line. Adjusted best time is saved locally in browser storage.
- The complete 11-gate run and the final finish/results/replay sequence were not manually completed. Mobile multi-touch was not tested on a physical phone.
- No mobile-device frame-rate claim is made. Vite reports a bundle-size advisory because Three.js is included in one client chunk.
