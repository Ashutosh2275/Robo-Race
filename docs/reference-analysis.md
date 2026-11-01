# Reference analysis

## Scope

The nine WhatsApp photographs are the primary evidence for the supplied physical robot and demonstration obstacles. The older black-robot and arena images remain supplementary visual references; the generated 20-asset board is inspiration for modular construction and is not used as a texture. None of the photographs provides a reliable scale reference or a clear view of all internal components.

The visible robot has two parallel continuous black tracks, pale circular end wheels, yellow protective track covers, a dark low chassis and an open equipment bay. The photos show wrapped or obscured objects in the bay but do not establish the battery chemistry/capacity, motor model, ESC model, exact dimensions, drivetrain arrangement or connector type. Those values remain simulation assumptions and must not be described as measured specifications.

## Individual photograph observations

| Filename | Visible evidence | Implementation relevance | Confidence limits |
|---|---|---|---|
| `WhatsApp Image 2026-10-31 at 10.37.11 PM (1).jpeg` | Close side view: yellow protective covers, black belt with visible tread lugs, pale circular end wheels, dark frame and an open top bay. | Main `TrackedRobot` silhouette, paired `TrackAssembly` groups, protective covers, wheel hubs and bay framing. | Number/location of hidden rollers, belt construction and dimensions are not measurable. |
| `WhatsApp Image 2026-10-31 at 10.37.11 PM.jpeg` | Top view while the bay is being handled; a separate handheld radio is visible behind the robot. | Open-bay framing and manual RC-control context. | Hand/objects obscure wiring and components. Radio appearance does not establish protocol or channel mapping. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (1).jpeg` | A long dark plank bridges ground levels to a broad raised landing; the robot is on the plank. | Narrow plank bridge and elevated transition geometry; gravity, traction and support must affect movement. | Board supports, thickness and slope are not known. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (2).jpeg` | Several separate flat boards lead to a raised edge; another inclined board is visible beyond. | Independently modeled stepping platforms and ramp transition. | Exact elevations, gaps, material and route order cannot be inferred reliably. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (3).jpeg` | Robot beside a broad dark inclined board; temporary staging boards and a slatted ramp appear in the background. | Steep-ramp and raised-platform variants with continuous collision support. | It is unclear whether all visible obstacles belong to one course. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (4).jpeg` | Robot descending a narrow board from an elevated rough landing. | Downhill ramp: gravity-driven motion, surface-dependent traction and braking. | Actual grade and board surface treatment are unknown. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (5).jpeg` | Robot pushing into irregular loose stones; stones contact its front and underside. | 3D rubble geometry and terrain response; avoid representing the field only with a flat texture. | Stone mass, friction and size distribution are not measured. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM (6).jpeg` | Two separated long planks form a parallel-plank crossing above a drop, with the robot near the far landing. | Two independently supported planks and track-width alignment challenge. | Plank spacing, hidden support and exact dimensions are uncertain. |
| `WhatsApp Image 2026-10-31 at 10.37.12 PM.jpeg` | A single broad dark board rises from the robot toward a masonry landing. | Long ramp with visible lower approach and raised exit. | Board stiffness, grade and height cannot be determined from perspective. |

## Existing implementation audit

- Engine: Vite, TypeScript and Three.js with WebGL, ACES tone mapping, a `RoomEnvironment` reflection environment, directional shadows and procedural canvas textures.
- Vehicle and physics: custom deterministic differential-track physics in `src/drivePhysics.ts` and 3D pose/rollover handling in `src/vehicleDynamics.ts`; it is not a rigid-body engine.
- Input: `src/universalController.ts` and `src/driveControls.ts` unify keyboard, touchscreen and gamepad axes. Radio transmitters are only supported when exposed to the browser as compatible HID/gamepad input.
- Course: `src/courseLayout.ts` defines surface/height sampling, checkpoints, recovery anchors and deterministic rocks. `src/main.ts` builds the rendered obstacles and collision proxies.
- Camera: four modes existed at audit time. Garage inspection was an automatic orbit; this implementation milestone adds mouse drag orbit, wheel zoom, adjustable FOV/sensitivity and camera obstruction checks. The camera does not drive or move the robot.
- Persistence: browser local storage stores preferences and the best race time. It does not currently serialize a recoverable live race snapshot.
- Rendering limits: browser PBR and generated textures can provide useful material response but do not make this scene photorealistic; no scanned robot model, measured hardware, physically based rigid-body solver, baked lightmaps, ray tracing, DLSS or GPU profiling is present.

## Simulation assumptions

The battery capacity, voltage curve, current draw, motor torque/thermal response, ESC response and damage rates are gameplay tuning values. They are not specifications inferred from the photographs. Exact physical scale is likewise an approximate game scale until measured dimensions are supplied.
