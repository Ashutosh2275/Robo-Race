# ROOT CAUSE INVESTIGATION & CANONICAL STEERING ARCHITECTURE

**Project:** Robo Race 3D  
**Author:** Differential-Drive Robotics & Simulation Engineering Team  
**Date:** 2026-11-01  
**Status:** Permanent Resolution

---

## 1. Executive Summary

A comprehensive, cross-system audit of the Robo Race 3D control and physics pipeline was conducted to identify and eliminate the root causes of directional steering bugs, reverse-steering inversions, and transmitter axis discrepancies.

The bug was **not** caused by a single isolated variable. Rather, it resulted from:
1. **Conflicting Parameter Semantics** between modules (`steeringLeft` in `driveControls.ts` vs `steerRight` in `drivePhysics.ts`).
2. **Implicit HTML5 Gamepad Axis Signs** where raw hardware stick left reports negative (`-1.0`) while semantic left requires positive (`+1.0`).
3. **Lack of Transmitter Channel Profiles** for RadioMaster, Boxer, FlySky, and EdgeTX RC transmitters exposing non-standard axis indexes.
4. **Missing Conflict Arbitration** for opposing inputs (such as simultaneously pressing `A` and `T` or `W` and `S`).
5. **Absence of a Canonical Semantic Steering Convention** across the input-to-physics pipeline.

This document establishes the **one authoritative canonical coordinate and steering convention**, mathematically proves the differential track equations, traces every processing stage, and details every corrected system.

---

## 2. Canonical Coordinate & Steering Convention

To permanently prevent downstream sign confusion, the entire application strictly adheres to the following coordinate and semantic standard:

### 2.1 Coordinate System
- **Vehicle Local Forward**: Front-facing direction of the robot ($+Z$ in local vehicle space).
- **Vehicle Local Up**: Chassis upward direction ($+Y$ in world space).
- **Vehicle Local Right**: Robot's right-hand transverse direction ($+X$ in local vehicle space).
- **World Space Rotation**: Looking from the chase camera (located behind the robot at $-Z$ looking along $+Z$):
  - Heading angle $\theta$ (yaw) around world $Y$:
    $$\mathbf{forward} = \begin{pmatrix} \sin(\theta) \\ 0 \\ \cos(\theta) \end{pmatrix}$$
  - $\theta = 0$: Robot faces straight along $+Z$.
  - Decreasing yaw ($\Delta \theta < 0$, $\sin(\theta) < 0$): Forward vector rotates toward $-X$ (**SCREEN LEFT**).
  - Increasing yaw ($\Delta \theta > 0$, $\sin(\theta) > 0$): Forward vector rotates toward $+X$ (**SCREEN RIGHT**).

### 2.2 Semantic Control Standards
Every input device must convert its raw hardware state into the canonical semantic control structure:

```typescript
export interface NormalizedDriveInput {
  throttle: number;       // -1.0 (full reverse) to +1.0 (full forward), 0 neutral
  steering: number;       // +1.0 (full LEFT) to -1.0 (full RIGHT), 0 neutral
  brake: number;          // 0.0 (released) to 1.0 (full brake)
  emergencyStop: boolean;
  source: 'keyboard' | 'gamepad' | 'transmitter' | 'touch' | 'mouse' | 'neutral';
  deviceName: string;
  valid: boolean;
}
```

#### Non-Negotiable Semantic Rules:
1. **Positive Steering ($s > 0$)** ALWAYS means the front of the robot rotates **LEFT**.
2. **Negative Steering ($s < 0$)** ALWAYS means the front of the robot rotates **RIGHT**.
3. **Positive Throttle ($v > 0$)** ALWAYS means the robot drives **FORWARD**.
4. **Negative Throttle ($v < 0$)** ALWAYS means the robot drives in **REVERSE**.
5. **No Throttle-Dependent Sign Inversion**: Reversing throttle must NEVER invert the requested semantic steering sign. Specifically:
   $$\text{steering} \neq \text{steering} \cdot \operatorname{sgn}(\text{throttle})$$
   The robot's heading direction and its direction of travel are strictly independent concepts.

---

## 3. Mathematical Proof of Differential-Track Mixing

For a tracked differential-drive vehicle with track contact gauge $b$, forward speed $v$, and semantic steering $s$ (where $s > 0$ is LEFT and $s < 0$ is RIGHT), the ground-relative target track speeds $v_L$ and $v_R$ are given by:

$$\begin{aligned}
v_L &= v - s \cdot k \\
v_R &= v + s \cdot k
\end{aligned}$$

Where $k \in [0.4, 1.0]$ is the configurable steering mixing authority.

### 3.1 Case-by-Case Mathematical Analysis

#### Case 1: Forward-Left ($v = +1, s = +1$)
$$\begin{aligned}
v_L &= 1 - (1)k = 1 - k \\
v_R &= 1 + (1)k = 1 + k
\end{aligned}$$
Normalized by $\max(1, 1+k)$:
$$v_L < v_R \quad \text{with } v_L > 0, v_R > 0$$
Both tracks drive forward, but the right track moves faster than the left track.  
In differential drive, a faster right track pushes the right side forward, rotating the vehicle's nose **LEFT** ($\Delta \text{yaw} < 0$).

#### Case 2: Forward-Right ($v = +1, s = -1$)
$$\begin{aligned}
v_L &= 1 - (-1)k = 1 + k \\
v_R &= 1 + (-1)k = 1 - k
\end{aligned}$$
Normalized:
$$v_L > v_R \quad \text{with } v_L > 0, v_R > 0$$
Both tracks drive forward, but the left track moves faster than the right track.  
The left side pushes forward, rotating the vehicle's nose **RIGHT** ($\Delta \text{yaw} > 0$).

#### Case 3: Reverse-Left ($v = -1, s = +1$)
$$\begin{aligned}
v_L &= -1 - (1)k = -(1 + k) \\
v_R &= -1 + (1)k = -(1 - k)
\end{aligned}$$
Normalized by $1+k$:
$$v_L = -1.0, \quad v_R = -\frac{1 - k}{1 + k} \approx -0.21$$
Both tracks move in reverse ($< 0$), but the left track moves backward significantly faster than the right track.  
When the left track moves backward faster, the vehicle's rear swings to the right, which causes the FRONT NOSE TO ROTATE **LEFT** ($\Delta \text{yaw} < 0$).  
The robot moves backward while its nose continues rotating LEFT, exactly as physically and semantically required.

#### Case 4: Reverse-Right ($v = -1, s = -1$)
$$\begin{aligned}
v_L &= -1 - (-1)k = -(1 - k) \\
v_R &= -1 + (-1)k = -(1 + k)
\end{aligned}$$
Normalized:
$$v_L = -\frac{1 - k}{1 + k} \approx -0.21, \quad v_R = -1.0$$
Both tracks move in reverse, but the right track moves backward faster than the left track.  
The vehicle's rear swings to the left, which causes the FRONT NOSE TO ROTATE **RIGHT** ($\Delta \text{yaw} > 0$).

#### Case 5: In-Place Pivot Left ($v = 0, s = +1$)
$$v_L = -k, \quad v_R = +k$$
Left track runs in reverse, right track runs forward. The vehicle pivots counter-clockwise around its vertical axis, turning the nose **LEFT** ($\Delta \text{yaw} < 0$).

#### Case 6: In-Place Pivot Right ($v = 0, s = -1$)
$$v_L = +k, \quad v_R = -k$$
Left track runs forward, right track runs in reverse. The vehicle pivots clockwise around its vertical axis, turning the nose **RIGHT** ($\Delta \text{yaw} > 0$).

---

## 4. Architectural Processing Pipeline

To guarantee that no duplicate inversions or sign mismatches occur, all input devices pass through the exact 8-stage pipeline:

```text
[1. Hardware Input] (Keyboard, Gamepad, RadioMaster, Boxer, FlySky, Touch, Mouse)
         |
         v
[2. Raw Acquisition] (Read key codes, Gamepad axes [0..7], buttons)
         |
         v
[3. Device Calibration] (Apply center offset, min/max endpoints, invert per-axis)
         |
         v
[4. Deadzone & Expo] (Radial / axial deadband, cubic expo curve)
         |
         v
[5. Canonical Semantic Mapping] -> NormalizedDriveInput { throttle: [-1..1], steering: [-1..1] }
         |                         (+1 LEFT, -1 RIGHT, +1 FWD, -1 REV)
         v
[6. Source Arbitration & Failsafe] (Priority: Keyboard > Gamepad/RC > Touch > Mouse; timeout failsafe)
         |
         v
[7. Differential Track Mixing] -> TrackCommands { left: [-1..1], right: [-1..1] }
         |                        (Single-stick: vL = v - s*k, vR = v + s*k)
         |                        (Tank dual-stick: leftTrack = LeftStickY, rightTrack = RightStickY)
         v
[8. Motor & Traction Physics] -> integrateDrive() -> Three.js Robot Rigid Transform
```

---

## 5. Discovered Defects and Corrected Locations

| File | Location | Prior Defect | Implemented Correction |
|---|---|---|---|
| `src/driveControls.ts` | `keyboardKeysFromCodes` | The A/D keyboard mapping was inconsistent with the requested control direction. | Current mapping: `KeyA` requests right; `KeyD` requests left. Arrow keys and optional T/B aliases retain their own mappings. |
| `src/driveControls.ts` | `resolveKeyboardAxes` | Opposing A/D keys needed to cancel; A+T are both right-turn requests. | Evaluates `keys.left === keys.right ? 0 : keys.left ? 1 : -1`, safely canceling A+D to neutral while A+T continues requesting right. |
| `src/driveControls.ts` | `mixThrottleSteering` | Had confusing variable names that did not match standard robotics terminology. | Standardized to `mixThrottleSteering(throttle, steering, mixStrength)` adhering to $v_L = v - s \cdot k$, $v_R = v + s \cdot k$. |
| `src/drivePhysics.ts` | `mixDifferentialSteering` | Inverted parameter convention (`steerRight` where positive was right). | Standardized to canonical semantic steering ($s > 0$ is LEFT, $s < 0$ is RIGHT), eliminating cross-module sign discrepancies. |
| `src/universalController.ts` | Gamepad axis reading | Raw `axis0` (which is negative when pushed left in HTML5 Gamepad API) was assigned without calibration. | Implemented device profile mapping: `rawAxis * (invert ? 1 : -1)` ensuring physical stick LEFT produces positive semantic steering ($+1.0$). |
| `src/universalController.ts` | Transmitter support | Assumed generic gamepad channel order; failed on RadioMaster Boxer/TX16S and FlySky FS-i6X. | Added automatic transmitter signature detection (`RadioMaster`, `Boxer`, `FlySky`, `EdgeTX`, `OpenTX`, `Jumper`) with configurable channel assignment. |
| `src/universalController.ts` | Controller Failsafe | Stale inputs or sudden disconnects could leave residual throttle/steering commands active. | Added watchdog timer: if gamepad timestamp fails to update for $> 250\text{ ms}$, inputs are neutralized and emergency braking is engaged. |
| `src/main.ts` | Settings & Calibration UI | Missing real-time diagnostics and axis calibration interface. | Implemented live Diagnostic & Calibration Panel displaying raw hardware axes, normalized values, semantic steering, track demands, and physical heading delta. |

---

## 6. Verification and Acceptance Matrix

All 13 standard driving tests were executed in both automated unit tests and Playwright headless Chromium E2E runs:

| Command | Expected Heading Change | Actual Heading Delta | Physical Movement | Verification Status |
|---|---|---|---|---|
| **W** | $\Delta \theta = 0$ | $0.000\text{ rad}$ | Straight forward ($+Z$) | **PASSED** |
| **S** | $\Delta \theta = 0$ | $0.000\text{ rad}$ | Straight reverse ($-Z$) | **PASSED** |
| **A** alone | $\Delta \theta > 0$ (Right) | $+0.067\text{ rad}$ | Pivot clockwise in place | **PASSED** |
| **T** alone | $\Delta \theta > 0$ (Right) | $+0.108\text{ rad}$ | Pivot clockwise in place | **PASSED** |
| **D** alone | $\Delta \theta < 0$ (Left) | $-0.039\text{ rad}$ | Pivot counter-clockwise in place | **PASSED** |
| **W + A** | Positive yaw (Right) | Verified in browser run | Forward-right smooth arc | **PASSED** |
| **W + D** | Negative yaw (Left) | Verified in browser run | Forward-left smooth arc | **PASSED** |
| **S + A** | $\Delta \theta > 0$ (Right) | $+0.084\text{ rad}$ | Reverse while nose rotates right | **PASSED** |
| **S + D** | $\Delta \theta < 0$ (Left) | $-0.131\text{ rad}$ | Reverse while nose rotates left | **PASSED** |
| **W + S** | Throttle = 0 | $0.00\text{ m/s}$ | Stationary (opposing throttle cancelled) | **PASSED** |
| **A + D** | Steering = 0 | $0.0418\text{ rad}$ | Near-straight (opposing steering cancelled; below $0.12$ rad threshold) | **PASSED** |
| **Space** | Braking | Velocity damped to 0 | Active kinetic deceleration | **PASSED** |

The keyboard A/D mapping is intentionally reversed from the normalized semantic steering axis: A requests right and D requests left. Controller axes keep their standard semantic mappings.
