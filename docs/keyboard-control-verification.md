# Keyboard control verification

## Automated checks

Run with `npm test`. The controls suite evaluates all 16 possible W/S/A/D held-state combinations, verifies the eight directional states through the same `integrateDrive` physics used by the game, checks opposing-key cancellation and output clamps, and preserves slope/traction tests.

## Manual gameplay checklist

- [ ] In a live race, W accelerates forward and releasing it returns commanded tracks to zero.
- [ ] S drives in reverse; forward-to-reverse transitions are limited by motor force and braking rather than teleporting velocity.
- [ ] A pivots/turns left and D pivots/turns right.
- [ ] W+A / W+D trace forward left/right arcs; S+A / S+D trace reverse left/right arcs.
- [ ] W+S cancels throttle while preserving any unconflicted steering; A+D cancels steering while preserving any unconflicted throttle.
- [ ] W+S+A+D commands both tracks neutral.
- [ ] Quick key changes and releasing all keys leave no stale command.
- [ ] Pause, restart, window blur and tab hiding clear commands; controls work again after resume.
- [ ] When a touch joystick is held, keyboard takes temporary priority; on keyboard release, the still-held joystick resumes. A released stick returns to neutral.
- [ ] Verify slow precision, medium and full-speed turns, hairpins, hill climbing, downhill braking and low-grip slip.

## Browser check recorded for this change

- Chrome opened the local game at `http://127.0.0.1:5173/` and the live race started.
- Holding W advanced the race through the first ordered gate and raised the speed HUD.
- D-only produced a positive yaw reading; A-only produced a negative yaw reading, confirming right/left rotation in the running game.
- W+D advanced through a gate with positive yaw, demonstrating forward-right curved motion.
- After key release, the telemetry commands returned to zero and the displayed speed returned to zero; Escape paused the race with neutral command telemetry.
- The pause/resume, joystick multitouch, window blur and physical-phone portions remain a manual checklist; they were not claimed as verified in this browser pass.
