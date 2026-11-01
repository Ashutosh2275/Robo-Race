# Robo Race 3D — Tracked Differential-Drive Simulator

A browser-based tracked-robot racing simulator built with **Vite**, **TypeScript**, and **Three.js**. It uses a fixed-timestep custom differential-drive model, sampled terrain support, traction-limited slope motion, visual rollover, mechatronics estimates and environmental hazards. It is a game simulation, not a validated rigid-body robotics solver.

---

## Key Features

### 1. Differential Track Drive & Universal Controls
- **Exact Kinematics**:
  $$v_L = v - \frac{\omega \cdot b}{2}, \quad v_R = v + \frac{\omega \cdot b}{2}$$
- **Calibrated Directional Steering**:
  - Keyboard `A` turns counter-clockwise in the chase view; `D` turns clockwise.
  - `W+A` / `W+D` produce left/right forward curves. Reverse steering follows driving-game path curvature: `S+A` curves clockwise and `S+D` counter-clockwise.
  - Optional `T` / `B` keys remain clockwise-turn aliases; arrow keys follow their named directions.
  - Keyboard direction adaptation is isolated from the nose-relative touchscreen/gamepad differential controls.
  - `W+S` cancels throttle to neutral; `A+D` cancels steering to neutral.
  - Browser focus loss or tab switching immediately zeroes commands to prevent runaway robots.
- **Universal Device Support**:
  - Keyboard & Mouse
  - Mobile Touch Joysticks (Dual-stick Tank Mode and Single-stick Mode)
  - Gamepads (Xbox One/Series, PlayStation DualShock/DualSense, Generic USB)
  - RC Transmitters (RadioMaster Boxer, Pocket, TX16S, FlySky, EdgeTX via USB HID joystick mode)
  - Configurable dead zones, exponential (expo) response curves, and sensitivity scaling.

### 2. Four-wheel, two-motor tracked robot
- Exactly four primary end wheels: two per side, with one powered wheel and one passive belt-driven idler on each side.
- Exactly two independent motor configurations at the user-specified 600 RPM, driving two continuous visual belts. The default powered pair is left-front/right-rear; the supplied photos do not identify the powered diagonal, so this is configurable.
- RPM and torque are converted through a configurable gear ratio, gearbox efficiency, sprocket radius and simulated mass. Gear ratio (1.8), torque (2 Nm), sprocket radius (0.18 m) and robot mass (2 kg) are provisional game-tuning assumptions, not measured specifications.
- The visual belt underside is aligned with four sampled ground contacts. The controller follows a height field; it does not solve every mesh as a physical rigid body.

### 3. Fixed Rigid Chassis Model & Mechatronics Cutaway
- **Rigid Silhouette Guarantee**: The robot chassis mesh maintains strictly fixed dimensions and cannot stretch, bulge, or deform during movement or high-speed impacts.
- **Visual Design**: Rugged industrial yellow protective track covers, exposed pale circular drive sprockets and idler road wheels, and black continuous rubber tracks.
- **Open Compartment Mechatronics**:
  - Generic simulation-only battery, connector, motor, controller and receiver stand-ins in the cutaway; exact hardware models are not verified by the photographs
- **Cutaway Mode**: Toggle with `⚙ CUTAWAY` to inspect interior components.

### 4. 3D Rollover, Inverted State & Checkpoint Recovery
- Full 3D pose tracking: `pitch`, `yaw`, `roll`, and angular velocities.
- Dynamic ground tracking with tipping torques when driving off bridges or steep ramps.
- Overturn detection: when tilted past $90^\circ$, the vehicle enters an upside-down resting state where tracks spin in the air without ground traction.
- Safe Recovery Anchors: 10 designated safe recovery points along the route. Press `R` or the recovery button to reset upright with zero velocity and an added time penalty.
- Structural integrity at zero ends the attempt, disables the drivetrain and requires a race restart; ordinary recovery cannot revive a destroyed robot.

### 5. Course Layout & Environmental Hazards
- **Course Sections**:
  1. Starting straight with gantry and lane markings
  2. 5-staggered slalom gates with guaranteed $2.8\text{ m}$ lane clearance
  3. 3 rounded speed breakers
  4. Curved timber ramp ($3.0\text{ m}$ length, $0.88\text{ m}$ elevation)
  5. Elevated bridge ($0.62\text{ m}$ height) with safety railings and trestles
  6. Marble pit with loose pebbles
  7. Rotating steel disc platform with surface momentum transfer
  8. Mixed terrain strip (sand, gravel, turf, rubber mat)
  9. Deterministic Rock Field with 3D irregular polyhedral stones
  10. **Mandatory Environmental Hazard Sequence**: **Fire → Short Transition → Water → Oil**
      - **Fire Zone**: Burning jets, progressive temperature rise, track degradation
      - **Transition**: Clean metal platform
      - **Water Zone**: Cooling basin rapidly reducing motor/ESC temperatures while reducing grip
      - **Oil Slicks**: Dark reflective fluid puddles with ultra-low grip ($0.18$), causing extended braking and dynamic sliding
  11. **Switchback Climbing Hill**: Multi-leg diagonal climbing ramps ($16^\circ$ grade) with wide $4\text{ m}$ turning landings, summit plateau, and realistic force-based climb vs track spinning vs backward sliding under gravity.
  12. Corrected parallel plank bridge with plank spacing calibrated to the $1.58\text{ m}$ track center distance.
  13. 11 sequential checkpoint gates with illuminated indicators.

### 6. Mechatronics Simulation Subsystems
- **Battery System**: Simulated charge, voltage, current and estimated runtime respond to motor load and track slip. Numeric capacity and voltage curve are gameplay defaults, not verified specifications of the real robot.
- **Motors**: Independent left/right temperature and thermal throttling use gameplay coefficients, not measured motor specifications.
- **ESC**: Simulated temperature and power delivery with gradual overheating response; the real ESC model is unknown.
- **Integrity**: Gameplay condition values for chassis, left track, right track, drive wheels and electronics enclosure; these are not engineering-grade measurements.

---

## Getting Started

### Prerequisites
Node.js 20.19+ or 22.12+ and npm.

### Installation
```bash
npm install
```

### Development Server
```bash
npm run dev
```

### Production Build & Preview
```bash
npm run build
npm run preview
```

### Running Test Suites
```bash
npm test
```
Runs 47 automated tests across differential kinematics, vehicle dynamics, drivetrain topology, mechatronics subsystems, route layout, and obstacle clearances.

### Running E2E Gameplay Verification
```bash
npm run verify
```
Launches a headless browser instance, verifies rendering, starts a live race, tests the 8-directional movement matrix, takes screenshots, and verifies all HUD readouts.

---

## Controls Summary

### Camera
- Press **C** or use **CAMERA** to cycle chase, low bumper, tactical overhead and garage inspection views.
- In garage inspection view, drag over the scene to orbit and use the mouse wheel to zoom. Camera Field of View and Orbit Sensitivity are adjustable in Settings. Camera movement does not apply vehicle input.

| Input | Action |
|---|---|
| **W** | Drive forward |
| **S** | Drive backward |
| **A** | Turn front toward right |
| **D** | Turn front toward left |
| **W + A** | Forward-right curved movement |
| **W + D** | Forward-left curved movement |
| **S + A** | Reverse while front turns right |
| **S + D** | Reverse while front turns left |
| **Space** | Mechanical brake |
| **R** | Safe recovery to last checkpoint |
| **C** | Cycle camera (Chase, Low Bumper, Tactical, Garage) |
| **F3** | Toggle debug HUD |
| **Esc** | Pause / resume |
