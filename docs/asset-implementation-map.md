# Asset implementation map

This map connects the user-provided photographs to reusable scene components and behavior. Meshes are constructed in Three.js and are not imported scans. Collision shapes are simplified proxies for stable gameplay.

| Reference(s) | Reusable asset/component | Current implementation | Physical behavior / known limit |
|---|---|---|---|
| WhatsApp `(1)` at 10:37:11 PM | `TrackedRobot`, `TrackAssembly`, covers, wheels, open bay | `src/main.ts` robot assembly built from shared Three.js geometry/materials; drivetrain topology in `src/drivetrainConfig.ts` | The user's stated hardware spec is modeled as four primary end wheels, two belts and two motors. Photos do not prove which wheel is powered; the default left-front/right-rear diagonal is configurable. |
| WhatsApp at 10:37:11 PM | Open-bay inspection configuration | `cutawayMode`, generic battery/motor/ESC/receiver stand-ins in `src/main.ts` | Visual inspection mode only; component layout is a documented plausible stand-in because the bay contents are obscured. |
| WhatsApp `(1)` at 10:37:12 PM and WhatsApp at 10:37:12 PM | `NarrowPlankBridge`, `SteepRamp`, `ElevatedPlatformTransition` | Ramp/deck collision proxies and height sampling in `src/courseLayout.ts`, rendered meshes in `src/main.ts` | Uphill force, slope gravity, braking and traction are simulated; geometry is game scale and not a measured reconstruction. |
| WhatsApp `(2)` at 10:37:12 PM | `SteppingPlatformSet` | Modular board meshes and route/collider definitions | Each supported board must have a corresponding walkable collider; exact spacing/elevation are game design values. |
| WhatsApp `(3)` and `(4)` at 10:37:12 PM | `SteepRamp` ascent/descent variants | Sloped route surfaces plus vehicle surface sampling | Gravity affects downhill motion; the custom controller approximates contact rather than solving a full rigid-body mesh collision. |
| WhatsApp `(5)` at 10:37:12 PM | `RubbleField` | Seeded irregular stone geometry from `generateRockFieldStones` in `src/courseLayout.ts` | Rendered rocks and terrain variation influence motion; stones are not individual dynamic rigid bodies. |
| WhatsApp `(6)` at 10:37:12 PM | `ParallelPlankBridge` | Separate plank meshes and collision regions in `src/main.ts` | Tracks need support on the planks; the model is simplified and does not include a deformable board solver. |
| Earlier black tracked robot photo | Supplementary silhouette reference | No longer controls exterior colour; yellow guards follow the newer real robot photographs | The older image is superseded for colour and visible construction. |
| Earlier generated arena reference | Course composition inspiration | Modular campus-race arena assembled from meshes | Artistic layout only; it is not an official university course blueprint. |
| Earlier 20-asset reference sheet | Individual asset style guide | Separate barriers, ramps, bridge, terrain, gates, disc and robot meshes | The sheet itself is never mapped as a single environment texture. |

## Shared systems

- Materials are declared and shared in `src/main.ts`; procedural textures are generated once for floor, rubber, wood, sand, gravel and slick surfaces.
- Course surface, height, checkpoints, route clearance, rock seed and recovery anchors are in `src/courseLayout.ts`.
- Differential force, traction limits, slope gravity and slip calculations are in `src/drivePhysics.ts`.
- The four-wheel/two-belt topology, 600 RPM motor configuration, gear/sprocket conversion and torque-derived drive acceleration are in `src/drivetrainConfig.ts`. Gear ratio, motor torque, sprocket radius and robot mass are adjustable gameplay assumptions because the photographs do not establish those measurements.
- Battery, motor/ESC thermal response, hazards and condition values are in `src/robotSubsystems.ts`. Numeric hardware values are simulation defaults, not measured robot specifications.
- Ground following uses four terrain contact probes. The rendered belt underside is aligned to the sampled ground plane using `TRACK_CONTACT_OFFSET` in `src/vehicleDynamics.ts`; the game does not use a full rigid-body contact solver.
- Camera orbit uses the rendered course as an obstruction query; this moves only the camera and does not alter vehicle physics.
