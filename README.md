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
- **A / D (or B):** A rotates left; D and B rotate right by differential track power; combinations with W or S make controlled curved paths.
- **W + S / A + D:** cancel only the conflicting axis. With W+S+A, the robot pivots left; all four keys together command neutral tracks.
- **Space:** brake.
- **R:** recover at the start or the last passed gate (adds the configurable recovery penalty).
- **C:** cycle chase, low chase and tactical camera views.
- **F3:** toggle route debug lines and collider bounds.
- **Escape:** pause / resume.
- **Mouse:** drag upward on the left or right half of the 3D view to command that track; release to return it to neutral.
- **Touch:** use the two lower-corner gimbals together. Vertical direction commands each track; horizontal stick movement steers left / right. Brake, pivot, reset, camera and pause controls are available on touch layouts.

Open **Settings** to select Low, Medium, High or Custom keyboard sensitivity and tune forward/reverse sensitivity, steering, turn-in-place, acceleration, braking, steering response, maximum speed and maximum rotation. The separate overall sensitivity slider scales all controls; dead zone, collision/recovery penalty, graphics quality, difficulty and race duration are also configurable. The optional **Input HUD** shows current track commands, throttle, steering, direction, speed and yaw rate. Difficulty changes available surface grip (Beginner 1.25×, Intermediate 1×, Advanced .84×, Expert .70×); obstacle dimensions are shared across presets. Timed runs support 2, 3, 5, 8, 10 minutes or a custom value. The penalty is a configurable game setting, not a universal competition rule.

## Project layout

- `src/main.ts` — Three.js arena, modular robot meshes, track surfaces, obstacle course, fixed-step differential controller, collisions, ordered gates, race state, camera, input and HUD.
- `src/drivePhysics.ts` — independent track force/traction model and slope integration.
- `src/drivePhysics.test.ts` — deterministic controller and slope tests.
- `src/driveControls.ts` — keyboard-axis conflict handling, differential mixing and sensitivity presets.
- `src/driveControls.test.ts` — exhaustive key-state and eight-direction movement tests using the in-game physics integrator.
- `docs/keyboard-control-verification.md` — automated test scope and manual gameplay checklist.
- `src/style.css` — responsive desktop and landscape touch interface.
- `public/reference-robot.png` — user-provided silhouette and material reference.
- `outputs/university-robo-racing-reference-review.md` — source review and caveats.
- `docs/reference-asset-mapping.md` — mapping of all nine new real-world photographs to visible vehicle/obstacle features and in-game counterparts.

## Course and approximations

The authored race arena is 38 × 30 m, presented at 1.3× world scale (about 49 × 39 m). Its route follows the supplied overhead composition: upper-left start, five-bar slalom, three speed breakers, curved ramp and elevated bridge across the upper course, marble pit and rotating disc on the right, sand/gravel/turf/rubber patches through the centre, a low-grip metal section at the front, then two hairpins and the finish on the left. The central connector includes separately supported stepping plates; the hairpin includes single- and parallel-plank modules. An optional three-leg switchback hill sits beside the main route with sampled ramp elevations and broad turning shelves. Eleven directional gates represent the main race sections. The course draws on obstacle examples in the research review and user photographs, but is an original design and does not claim to reproduce any university's exact rules or course.

Driving uses a deterministic 120 Hz fixed timestep, independent left/right motor requests, a per-track traction ceiling, custom box collision response, slope gravity, rolling resistance, lateral grip and braking. Tread cleats and rollers animate from each track's own driven speed, so they can spin while chassis progress is traction-limited; with neutral inputs they stop while gravity can still move the chassis downhill. Keyboard A is calibrated left; D and B are calibrated right. Route walls are generated from a rounded centreline and offset paths, with a visible opening into the optional hill bay. The F3 debug view shows the main centreline, corridor edges, collision boxes and gate markers. The robot now follows the new photographs: yellow protective track covers, dark lower chassis and belts, pale exposed end wheels and an open equipment bay with generic visual packages. The ramp, bridge, step plates, plank decks and hill use visible geometry and sampled ground heights. The marble bed uses a textured patch and decorative spheres with reduced traction, rather than individually simulated marbles. The disc applies capped surface-motion force rather than a full rigidbody simulation. Procedural surface textures distinguish sand, gravel, turf, rubber and the slick metal patch. A camera clearance check keeps the view from passing through overhead start/finish structures. This browser physics is a stable game approximation rather than an engineering-grade rigidbody simulation.

## Verification completed

- `npm run build` passes TypeScript checking and creates the Vite production bundle.
- `npm test` passes 17 deterministic input and fixed-step tests, including all 16 simultaneous WASD states, eight physical directional responses, opposing-key cancellation, keyboard/joystick priority, A-left and D/B-right mapping, turning arcs, traction-limited slip, neutral coasting, downhill gravity, braking and wall response.
- Opened the local game in the browser and confirmed the Three.js scene, updated yellow robot, 11-gate HUD and start menu render.
- Started a race and held W with a brief A input: the timer and gate counter advanced and the robot passed gates in order. This was a short interaction check, not a full course run.
- Paused the race and used **Restart Race**: the timer and gate count returned to zero and the three-second countdown restarted.
- Rebuilt after adjusting the course layout, bridge ramp mesh and camera clearance around the gantries. No browser console errors appeared in the inspected reload.
- The finish trigger requires all 11 ordered gates and then a westbound crossing of the finish line. Adjusted best time is saved locally in browser storage.
- The complete 11-gate run and final finish/results/replay sequence were not manually completed. The hill and plank modules were not driven end-to-end in browser QA. Mobile multi-touch was not tested on a physical phone.
- During the keyboard-control update, browser gameplay verified W progression, A negative yaw, D positive yaw, W+D gate progression with right yaw, neutral input telemetry after release, and Escape pause. Touch multi-pointer, blur recovery and the full eight combinations were covered by code/unit checks and the manual checklist, not by a physical phone or fully scripted browser input sequence.
- Battery capacity/health, ESC and motor temperatures, component wear/repair, and fire/water hazard interactions are not implemented. Versioned local storage saves settings and the active race timer, penalty and gate count; after refresh the robot resumes paused at the last validated checkpoint. The full physical position between checkpoints is intentionally discarded for safe recovery. Best adjusted time remains local to the browser.
- Difficulty presets currently change grip only; ramp heights, platform spacing and barrier widths do not yet vary by preset. The optional hill and added plank modules were not driven end-to-end in browser QA.
- No mobile-device frame-rate claim is made. Vite reports a bundle-size advisory because Three.js is included in one client chunk.
