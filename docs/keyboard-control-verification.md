# Keyboard Control & Universal Driving Verification

## Differential Drive Kinematics & Directional Logic

The vehicle is a tracked differential-drive robot governed by the fundamental kinematics:

$$v_L = v - \frac{\omega \cdot b}{2}$$
$$v_R = v + \frac{\omega \cdot b}{2}$$

where:
- $v$ is commanded linear velocity (forward $> 0$, reverse $< 0$).
- $\omega$ is the semantic left-turn rate ($\omega > 0$ for left, $\omega < 0$ for right). Three.js uses +Z-forward and positive world-Y yaw turns right, so engine yaw rate has the opposite sign.
- $b$ is the contact center distance ($1.58\text{ m}$).
- $v_L, v_R$ are ground-relative left and right track target velocities.

### Strict Steering Rules
1. **A always turns the robot's front to the LEFT relative to heading**, regardless of whether W (forward) or S (reverse) is held.
2. **D always turns the robot's front to the RIGHT relative to heading**, regardless of whether W (forward) or S (reverse) is held.
3. Reversing throttle never flips the steering sign.
4. Opposing inputs resolve cleanly:
   - `W + S` cancels throttle to neutral while preserving active steering.
   - `A + D` cancels steering to neutral while preserving active throttle.
   - `W + S + A + D` cancels all inputs to neutral.
5. Releasing keys immediately restores neutral commands subject to motor torque limits and physical rolling drag.

---

## Mandatory Eight-Direction Movement Matrix

| Input | State Name | Left Track | Right Track | Front Yaw Rotation | World Translation |
|---|---|---|---|---|---|
| **W** | Forward | $+1.00$ | $+1.00$ | Neutral ($0$) | Forward along heading |
| **S** | Reverse | $-1.00$ | $-1.00$ | Neutral ($0$) | Reverse along heading |
| **A** | Pivot Left | $-0.48$ | $+0.48$ | Counter-clockwise (Left) | Zero translation (in-place) |
| **D / B** | Pivot Right | $+0.48$ | $-0.48$ | Clockwise (Right) | Zero translation (in-place) |
| **W + A** | Forward-Left Arc | $+0.14$ | $+1.00$ | Left ($\Delta \text{yaw} < 0$) | Forward curving to left |
| **W + D** | Forward-Right Arc | $+1.00$ | $+0.14$ | Right ($\Delta \text{yaw} > 0$) | Forward curving to right |
| **S + A** | Reverse-Left Arc | $-1.00$ | $-0.14$ | Left ($\Delta \text{yaw} < 0$) | Reverse with nose turning left |
| **S + D** | Reverse-Right Arc | $-0.14$ | $-1.00$ | Right ($\Delta \text{yaw} > 0$) | Reverse with nose turning right |
| **Space** | Mechanical Brake | $0.00$ | $0.00$ | Stopped | Decelerates to stop |
| **R** | Safe Recovery | $0.00$ | $0.00$ | Aligned with anchor | Restored upright at checkpoint |

---

## 3D Rollover, Pitch/Roll & Recovery Verification
- Full 3D pose integration: `pitch`, `yaw`, `roll`.
- Inverted state detection: when pitch or roll exceeds $90^\circ$ ($1.55\text{ rad}$), `isFlipped = true`.
- When overturned:
  - Tracks spin in air with zero ground traction.
  - Vehicle rests on roof/chassis covers.
  - Rollover warning banner is displayed on HUD.
  - Pressing `R` restores upright orientation at the nearest safe recovery anchor with zero velocities and adds penalty time.
  - Recovery cooldown ($1.0\text{ s}$) prevents accidental spam.

---

## Subsystems & Hazards Verification
1. **Battery System**: 4S LiPo $5000\text{ mAh}$, nominal $14.8\text{ V}$, discharge curve from $16.8\text{ V}$ to $13.0\text{ V}$. Current scales dynamically with driving demand and track slippage.
2. **Brushless Motors & Thermal Throttling**: Independent left and right motor temperatures. High slip and sustained high throttle raise temperature. Thermal throttling protects motors if temperature exceeds $85^\circ\text{C}$.
3. **Dual ESC**: Overheat cutoff protection at $105^\circ\text{C}$ with limp mode.
4. **Mandatory Environmental Hazards**:
   - **Fire Zone**: Paved heat zone with burning jets, increasing motor/ESC/battery temperatures and degrading track integrity over time.
   - **Transition**: Clean metal platform separating hazards.
   - **Water Zone**: Cooling basin rapidly cooling overheated motors ($-20^\circ\text{C/s}$) and ESC while reducing traction ($0.58\text{ grip}$).
   - **Oil Slicks**: Dark glossy reflective fluid patches with very low grip ($0.18$), causing extended braking distance and realistic track sliding.

---

## Automated Test Suites

The current suite contains 47 unit tests across seven test files, including directional gate crossing, slalom module geometry, ground-contact height, recovery clearance selection, four-wheel/two-motor topology, and zero-integrity shutdown.

The Chromium gameplay check measures the live robot yaw while holding A and D, tests W+A/W+D and S+A/S+D, checks opposing steering, compares the track underside with sampled terrain, validates course clearance, forces structural integrity to zero and confirms motion stays stopped until restart. The 2026-11-01 run passed. It does not verify every physical controller model or complete a full human-driven race.
