# Keyboard control verification

## Automated checks

Run with `npm test`. The controls suite evaluates all 16 canonical throttle/steering states, verifies the eight directional states through the same `integrateDrive` physics used by the game, checks opposing-key cancellation and output clamps, and separately verifies the D/B right-turn alias.

## Manual gameplay checklist

- [ ] In a live race, W accelerates forward and releasing it returns commanded tracks to zero.
- [ ] S drives in reverse; forward-to-reverse transitions are limited by motor force and braking rather than teleporting velocity.
- [ ] A pivots/turns left; D and its B alias pivot/turn right.
- [ ] W+A / W+D / W+B trace forward curves; S+A / S+D / S+B trace reverse curves.
- [ ] W+S cancels throttle while preserving any unconflicted steering; A+D or A+B cancels steering while preserving any unconflicted throttle.
- [ ] W+S+A+D commands both tracks neutral.
- [ ] Quick key changes and releasing all keys leave no stale command.
- [ ] Pause, restart, window blur and tab hiding clear commands; controls work again after resume.
- [ ] When a touch joystick is held, keyboard takes temporary priority; on keyboard release, the still-held joystick resumes. A released stick returns to neutral.
- [ ] Verify slow precision, medium and full-speed turns, hairpins, hill climbing, downhill braking and low-grip slip.

## Browser check recorded for this change

- Chrome opened the local game at `http://127.0.0.1:5173/` and the live race started.
- Holding W advanced the race through the first ordered gate and raised the speed HUD.
- A-only produced the calibrated left track differential (left track faster, right track reverse); D-only and B-only produced the opposite right-turn differential.
- W+A produced a forward-left curved command; combined-key readout showed left track 1.00, right track 0.25, forward speed and the left steering command.
- S produced reverse motion after the physical controller's torque-limited direction transition; Space braking returned speed to zero.
- After key release, telemetry returned to zero, the robot slowed to a stop, and Escape paused with neutral commands. Resume and Restart Race restored play, zeroed race progress and restarted the countdown.
- Opening Settings cleared drive commands; pressing W while Settings remained open left telemetry neutral. High and Medium presets updated then restored their tuning values.
- Joystick multitouch, window/tab focus loss, actual phone testing, and all reverse-curve combinations were not verified in a physical device/browser pass; reverse curves are covered by deterministic physics tests and the remaining items stay on the manual checklist.
