import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UniversalController,
  classifyHardwareDevice,
  normalizeCalibratedAxis,
  type BindableAction,
} from './universalController.ts';

function makeButtons(count = 16, pressedIndices: number[] = [], analogValues: Record<number, number> = {}) {
  return Array.from({ length: count }, (_, idx) => {
    const val = analogValues[idx] !== undefined ? analogValues[idx] : (pressedIndices.includes(idx) ? 1 : 0);
    return {
      pressed: pressedIndices.includes(idx) || val > 0.5,
      touched: pressedIndices.includes(idx) || val > 0.05,
      value: val,
    };
  });
}

function makeGamepad(opts: {
  index?: number;
  id: string;
  mapping?: string;
  axes: number[];
  pressed?: number[];
  buttonValues?: Record<number, number>;
  connected?: boolean;
  timestamp?: number;
}) {
  return {
    index: opts.index ?? 0,
    id: opts.id,
    mapping: opts.mapping ?? '',
    axes: opts.axes,
    buttons: makeButtons(16, opts.pressed ?? [], opts.buttonValues ?? {}),
    connected: opts.connected ?? true,
    timestamp: opts.timestamp ?? 100,
  };
}

function withMockEnvironment(fn: (ctx: { setPads: (pads: any[]) => void; storage: Map<string, string> }) => void) {
  const prevNavigatorDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const prevStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  let pads: any[] = [];
  const storage = new Map<string, string>();

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => pads,
    },
  });

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, String(v)); },
      removeItem: (k: string) => { storage.delete(k); },
    },
  });

  try {
    fn({
      setPads: (nextPads: any[]) => { pads = nextPads; },
      storage,
    });
  } finally {
    if (prevNavigatorDesc) Object.defineProperty(globalThis, 'navigator', prevNavigatorDesc);
    else delete (globalThis as any).navigator;
    if (prevStorageDesc) Object.defineProperty(globalThis, 'localStorage', prevStorageDesc);
    else delete (globalThis as any).localStorage;
  }
}

test('classifyHardwareDevice accurately distinguishes Gamepads, RadioMaster, FlySky, Jumper/FrSky, and Generic HID', () => {
  assert.equal(classifyHardwareDevice('RadioMaster Boxer Joystick', ''), 'transmitter_radiomaster');
  assert.equal(classifyHardwareDevice('RadioMaster TX16S Mark II', ''), 'transmitter_radiomaster');
  assert.equal(classifyHardwareDevice('Pocket EdgeTX HID', ''), 'transmitter_radiomaster');
  assert.equal(classifyHardwareDevice('FlySky FS-i6X Simulator', ''), 'transmitter_flysky');
  assert.equal(classifyHardwareDevice('PPM RC Receiver USB Adapter', ''), 'transmitter_flysky');
  assert.equal(classifyHardwareDevice('vJoy iBus TX Controller', ''), 'transmitter_flysky');
  assert.equal(classifyHardwareDevice('Jumper T-Pro OpenTX', ''), 'transmitter_jumper');
  assert.equal(classifyHardwareDevice('FrSky Taranis QX7', ''), 'transmitter_jumper');
  assert.equal(classifyHardwareDevice('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02e0)', 'standard'), 'gamepad');
  assert.equal(classifyHardwareDevice('DualSense Wireless Controller', 'standard'), 'gamepad');
  assert.equal(classifyHardwareDevice('Logitech Gamepad F310', 'standard'), 'gamepad');
  assert.equal(classifyHardwareDevice('Custom Arcade HID 0x1234', ''), 'generic');
});

test('normalizeCalibratedAxis handles asymmetric min/center/max ranges accurately without clipping or bias', () => {
  const cal = { min: -0.78, center: 0.06, max: 0.82 };
  assert.equal(normalizeCalibratedAxis(0.06, cal), 0);
  assert.ok(Math.abs(normalizeCalibratedAxis(-0.78, cal) + 1) < 1e-6);
  assert.ok(Math.abs(normalizeCalibratedAxis(0.82, cal) - 1) < 1e-6);
  // Midpoint between center (0.06) and max (0.82) is 0.44 -> +0.5
  assert.ok(Math.abs(normalizeCalibratedAxis(0.44, cal) - 0.5) < 1e-6);
  // Clamps out-of-range spikes cleanly
  assert.equal(normalizeCalibratedAxis(-1.2, cal), -1);
  assert.equal(normalizeCalibratedAxis(1.4, cal), 1);
});

test('Standard Xbox/PlayStation gamepad drives sticks + analog RT/LT triggers + all 6 buttons even when sticks rest centered', () => {
  withMockEnvironment(({ setPads }) => {
    const controller = new UniversalController({ mode: 'single_stick' });
    const xboxRest = makeGamepad({
      id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)',
      mapping: 'standard',
      axes: [0, 0, 0, 0],
    });
    setPads([xboxRest]);

    // Centered sticks MUST still populate rawAxes diagnostics & process buttons
    const restOut = controller.poll();
    assert.equal(restOut.source, 'gamepad');
    assert.equal(controller.getDiagnostics().rawAxes.length, 4);
    assert.equal(restOut.throttle, 0);
    assert.equal(restOut.steering, 0);

    // Analog RT (buttons[7]) drives forward while left stick sits idle
    setPads([makeGamepad({
      id: xboxRest.id,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttonValues: { 7: 0.9 },
    })]);
    const rtOut = controller.poll();
    assert.ok(rtOut.throttle > 0.7, `expected RT trigger throttle forward, got ${rtOut.throttle}`);
    assert.ok(rtOut.leftTrack > 0.7 && rtOut.rightTrack > 0.7);

    // Analog LT (buttons[6]) drives reverse
    setPads([makeGamepad({
      id: xboxRest.id,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttonValues: { 6: 0.85 },
    })]);
    const ltOut = controller.poll();
    assert.ok(ltOut.throttle < -0.6, `expected LT trigger reverse, got ${ltOut.throttle}`);

    // Disabling trigger drive ignores RT/LT
    controller.setTriggerDrive(false);
    setPads([makeGamepad({
      id: xboxRest.id,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttonValues: { 7: 1.0 },
    })]);
    assert.equal(controller.poll().throttle, 0);
    controller.setTriggerDrive(true);

    // Exhaustive rising-edge check on all 6 digital button actions with centered sticks!
    // Defaults: brake=0, recover=1, changeCamera=2, techTimeout=3, skipGate=5, togglePause=9
    const buttonChecks: Array<{ btn: number; field: keyof typeof rtOut; edge: boolean }> = [
      { btn: 1, field: 'recover', edge: true },
      { btn: 2, field: 'changeCamera', edge: true },
      { btn: 3, field: 'techTimeout', edge: true },
      { btn: 5, field: 'skipGate', edge: true },
      { btn: 9, field: 'togglePause', edge: true },
    ];
    for (const chk of buttonChecks) {
      // Frame 1: pressed
      setPads([makeGamepad({ id: xboxRest.id, mapping: 'standard', axes: [0, 0, 0, 0], pressed: [chk.btn] })]);
      const p1 = controller.poll();
      assert.equal(p1[chk.field], true, `button ${chk.btn} must trigger ${String(chk.field)} on frame 1 even at rest`);
      // Frame 2: held -> rising-edge must NOT re-trigger
      const p2 = controller.poll();
      assert.equal(p2[chk.field], false, `button ${chk.btn} must not re-fire ${String(chk.field)} while held`);
      // Frame 3: released -> reset
      setPads([makeGamepad({ id: xboxRest.id, mapping: 'standard', axes: [0, 0, 0, 0], pressed: [] })]);
      controller.poll();
      // Frame 4: re-pressed -> fires cleanly again
      setPads([makeGamepad({ id: xboxRest.id, mapping: 'standard', axes: [0, 0, 0, 0], pressed: [chk.btn] })]);
      const p4 = controller.poll();
      assert.equal(p4[chk.field], true, `button ${chk.btn} must re-trigger ${String(chk.field)} after release`);
      setPads([makeGamepad({ id: xboxRest.id, mapping: 'standard', axes: [0, 0, 0, 0], pressed: [] })]);
      controller.poll();
    }

    // Continuous brake overrides forward throttle to 0 tracks
    setPads([makeGamepad({
      id: xboxRest.id,
      mapping: 'standard',
      axes: [0, -1, 0, 0],
      pressed: [0],
    })]);
    const brkOut = controller.poll();
    assert.equal(brkOut.brake, true);
    assert.equal(brkOut.leftTrack, 0);
    assert.equal(brkOut.rightTrack, 0);
  });
});

test('RadioMaster Boxer EdgeTX transmitter auto-configures Mode-2 Tank + Aux switches on axes[4..7]', () => {
  withMockEnvironment(({ setPads }) => {
    const controller = new UniversalController({ mode: 'tank_dual_stick' });
    const boxerId = 'RadioMaster Boxer Joystick';

    setPads([makeGamepad({
      id: boxerId,
      axes: [0, -0.5, -0.5, 0, -1, -1, -1, -1],
    })]);

    const out = controller.poll();
    assert.equal(out.source, 'transmitter');
    const profile = controller.getCurrentProfile();
    assert.equal(profile.type, 'transmitter_radiomaster');
    assert.equal(profile.leftTrackAxis, 2);
    assert.equal(profile.rightTrackAxis, 1);
    assert.ok(out.leftTrack > 0.35 && Math.abs(out.leftTrack - 0.5) < 0.12, `tank leftTrack=${out.leftTrack} must not square sensitivity`);
    assert.ok(out.rightTrack > 0.35 && Math.abs(out.rightTrack - 0.5) < 0.12);

    // Bind RadioMaster 2/3-position switches (Ch5..Ch8 -> axes[4..7]) to Recover, Tech Timeout, Skip Gate, Brake
    controller.setActionBinding('recover', { kind: 'axis', index: 4, threshold: 0.5, direction: 'high' });
    controller.setActionBinding('techTimeout', { kind: 'axis', index: 5, threshold: 0.5, direction: 'high' });
    controller.setActionBinding('skipGate', { kind: 'axis', index: 6, threshold: -0.5, direction: 'low' });
    controller.setActionBinding('brake', { kind: 'axis', index: 7, threshold: 0.5, direction: 'high' });

    // Trigger Ch5 + Ch6 high while driving, verify edge firing and drive preservation
    setPads([makeGamepad({
      id: boxerId,
      axes: [0, -0.5, -0.5, 0, 1.0, 1.0, 0.2, -1],
    })]);
    const sw1 = controller.poll();
    assert.equal(sw1.recover, true);
    assert.equal(sw1.techTimeout, true);
    assert.equal(sw1.skipGate, false);
    assert.equal(sw1.brake, false);

    // Next frame holding switches stays quiet for edge triggers
    const sw2 = controller.poll();
    assert.equal(sw2.recover, false);
    assert.equal(sw2.techTimeout, false);

    // Ch7 low + Ch8 high brake
    setPads([makeGamepad({
      id: boxerId,
      axes: [0, -0.8, -0.8, 0, 1.0, 1.0, -0.95, 0.95],
    })]);
    const sw3 = controller.poll();
    assert.equal(sw3.skipGate, true);
    assert.equal(sw3.brake, true);
    assert.equal(sw3.leftTrack, 0);
    assert.equal(sw3.rightTrack, 0);
  });
});

test('FlySky FS-i6X / PPM center calibration works accurately even with invertThrottle/invertSteering enabled & endpoint sweep persists', () => {
  withMockEnvironment(({ setPads }) => {
    const flyskyId = 'FlySky FS-i6X Simulator';
    const controller = new UniversalController({ mode: 'single_stick' });

    // Resting stick has annoying +0.06 steering and -0.05 throttle trim bias
    const restingFlysky = makeGamepad({
      id: flyskyId,
      axes: [0.06, -0.05, 0, 0, 0, 0],
    });
    setPads([restingFlysky]);
    controller.poll();

    // Enable BOTH inversions FIRST (this used to double the bias error in old UniversalController!)
    controller.toggleInvert('steering');
    controller.toggleInvert('throttle');
    assert.equal(controller.calibrateCenter(), true);

    const zeroedOut = controller.poll();
    assert.equal(zeroedOut.throttle, 0, 'throttle must be exact 0 after center calibration even with invert active');
    assert.equal(zeroedOut.steering, 0, 'steering must be exact 0 after center calibration even with invert active');

    // Run Endpoint Sweep across narrow asymmetric TX gimbal limits [-0.78, +0.81]
    controller.toggleInvert('steering');
    controller.toggleInvert('throttle'); // return to standard non-inverted polarity for sweep clarity
    controller.startEndpointCalibration();

    setPads([makeGamepad({ id: flyskyId, axes: [-0.78, -0.76, 0, 0, 0, 0] })]);
    controller.poll();
    setPads([makeGamepad({ id: flyskyId, axes: [0.81, 0.80, 0, 0, 0, 0] })]);
    controller.poll();
    setPads([restingFlysky]);
    assert.equal(controller.finishEndpointCalibration(), true);

    // At asymmetric physical stop axes[1] = -0.76 (forward push), output MUST reach full +1.0!
    setPads([makeGamepad({ id: flyskyId, axes: [0.06, -0.76, 0, 0, 0, 0] })]);
    const fullFwd = controller.poll();
    assert.ok(fullFwd.throttle > 0.99, `expected normalized throttle ~1.0 at -0.76 stop, got ${fullFwd.throttle}`);

    // At asymmetric physical stop axes[0] = +0.81 (full right), output steering MUST reach full -1.0!
    setPads([makeGamepad({ id: flyskyId, axes: [0.81, -0.05, 0, 0, 0, 0] })]);
    const fullRight = controller.poll();
    assert.ok(fullRight.steering < -0.99, `expected normalized steering ~-1.0 at +0.81 stop, got ${fullRight.steering}`);

    // Persist profile -> instantiate brand new UniversalController -> auto-loads saved asymmetric limits
    const controllerReloaded = new UniversalController({ mode: 'single_stick' });
    setPads([makeGamepad({ id: flyskyId, axes: [0.81, -0.76, 0, 0, 0, 0] })]);
    const reloadedOut = controllerReloaded.poll();
    assert.ok(reloadedOut.throttle > 0.99);
    assert.ok(reloadedOut.steering < -0.99);
  });
});

test('1-click interactive Auto-Axis polarity capture and Switch/Button Action Auto-Bind work cleanly', () => {
  withMockEnvironment(({ setPads }) => {
    const controller = new UniversalController({ mode: 'single_stick' });
    const txId = 'Jumper T-Pro EdgeTX';
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, -1, -1] })]);
    controller.poll();

    // User clicks "Capture Forward" -> pushes right-hand swapped axis 2 POSITIVE (+0.9)
    controller.startAxisAutoBind('throttle_fwd');
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0.9, 0, -1, -1] })]);
    controller.poll();

    const prof = controller.getCurrentProfile();
    assert.equal(prof.throttleAxis, 2);
    assert.equal(prof.invertThrottle, true, 'positive push forward auto-sets invertThrottle=true');

    // Pushing +0.9 now produces FORWARD drive (+throttle)!
    const fwd = controller.poll();
    assert.ok(fwd.throttle > 0.75, `auto-bound positive-push throttle must drive forward, got ${fwd.throttle}`);

    // User clicks "Capture Left Steering" -> pushes axis 3 NEGATIVE (-0.88)
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, -1, -1] })]);
    controller.poll();
    controller.startAxisAutoBind('steering_left');
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, -0.88, -1, -1] })]);
    controller.poll();

    const prof2 = controller.getCurrentProfile();
    assert.equal(prof2.steeringAxis, 3);
    assert.equal(prof2.invertSteering, false);
    const leftTurn = controller.poll();
    assert.ok(leftTurn.steering > 0.75, 'auto-bound left steering must turn LEFT (+steering)');

    // Action Auto-Bind: User clicks "Bind Skip Gate" -> flips EdgeTX Ch5 switch (axes[4] from -1 to +1)
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, -1, -1] })]);
    controller.poll();
    controller.startActionAutoBind('skipGate');
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, 1.0, -1] })]);
    const triggered = controller.poll();
    assert.equal(controller.getCurrentProfile().bindings.skipGate.kind, 'axis');
    assert.equal((controller.getCurrentProfile().bindings.skipGate as any).index, 4);
    // Note next frame holding doesn't double-fire; release + re-flip triggers cleanly
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, -1, -1] })]);
    controller.poll();
    setPads([makeGamepad({ id: txId, axes: [0, 0, 0, 0, 1.0, -1] })]);
    assert.equal(controller.poll().skipGate, true);
  });
});

test('Keyboard priority override, sustained steady hold (no false idle braking), Remove/Rescan USB, and Multi-device hot-switch', () => {
  withMockEnvironment(({ setPads }) => {
    const controller = new UniversalController({ mode: 'single_stick', failsafeTimeoutMs: 350 });
    const events: Array<{ ev: string; detail: string }> = [];
    controller.onDeviceEvent((ev, detail) => events.push({ ev, detail }));

    const boxer = makeGamepad({
      index: 0,
      id: 'RadioMaster Boxer Joystick',
      axes: [0, -0.8, 0, 0, -1, -1],
      timestamp: 42, // Static timestamp as Chrome keeps when stick is steady
    });
    setPads([boxer]);

    // Sustained steady hold must NEVER trigger false idle braking!
    for (let i = 0; i < 60; i++) {
      const steady = controller.poll();
      assert.equal(steady.source, 'transmitter');
      assert.equal(steady.failsafeActive, false);
      assert.ok(steady.leftTrack > 0.5 && steady.rightTrack > 0.5);
    }

    // Pressing keyboard immediately overrides USB controller without disconnect
    controller.handleKeyDown('KeyS');
    const kbOut = controller.poll();
    assert.equal(kbOut.source, 'keyboard');
    assert.ok(kbOut.leftTrack < 0 && kbOut.rightTrack < 0, 'KeyS reverses immediately over controller hold');

    // Releasing keyboard cleanly returns control to RadioMaster Boxer
    controller.handleKeyUp('KeyS');
    const backToTx = controller.poll();
    assert.equal(backToTx.source, 'transmitter');
    assert.ok(backToTx.leftTrack > 0.5);

    // Multi-device hot-switch: FlySky plugged in on index 1 and stick moved
    setPads([
      makeGamepad({ index: 0, id: 'RadioMaster Boxer Joystick', axes: [0, 0, 0, 0] }),
      makeGamepad({ index: 1, id: 'FlySky FS-i6X Simulator', axes: [0, 0, 0, 0] }),
    ]);
    controller.poll(); // snapshot baseline
    setPads([
      makeGamepad({ index: 0, id: 'RadioMaster Boxer Joystick', axes: [0, 0, 0, 0] }),
      makeGamepad({ index: 1, id: 'FlySky FS-i6X Simulator', axes: [0, -0.9, 0, 0] }),
    ]);
    const switched = controller.poll();
    assert.equal(switched.source, 'transmitter');
    assert.equal(controller.getCurrentProfile().type, 'transmitter_flysky');
    assert.ok(events.some(e => e.ev === 'switched' && e.detail.includes('FlySky')));

    // Remove active controller inside tool -> stays suppressed even if USB still plugged, keyboard still drives
    assert.equal(controller.removeActiveDevice(), true);
    assert.equal(controller.getDiagnostics().activeDeviceIndex, null);
    const removedOut = controller.poll();
    assert.equal(removedOut.source, 'neutral');
    assert.equal(removedOut.leftTrack, 0);
    assert.equal(removedOut.rightTrack, 0);
    controller.handleKeyDown('KeyW');
    assert.equal(controller.poll().source, 'keyboard');
    controller.handleKeyUp('KeyW');

    // Rescan USB un-suppresses and reconnects active USB device immediately
    controller.rescanDevices();
    assert.equal(controller.getDiagnostics().activeDeviceIndex, 0);
    controller.selectDeviceIndex(0);
    const restored = controller.poll();
    assert.equal(restored.source, 'transmitter');

    // Silent USB unplug clears state & activates safe neutral failsafe without NaN or stuck inputs
    setPads([]);
    const unplugged = controller.poll();
    assert.equal(unplugged.source, 'neutral');
    assert.equal(unplugged.leftTrack, 0);
    assert.equal(unplugged.rightTrack, 0);
    assert.equal(unplugged.failsafeActive, true);
  });
});

test('Triple-pass exhaustive verification matrix across all 5 controller types, both drive modes, and all 6 action bindings', () => {
  const devices = [
    { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', mapping: 'standard', expectedSource: 'gamepad' as const },
    { id: 'RadioMaster Boxer Joystick', mapping: '', expectedSource: 'transmitter' as const },
    { id: 'FlySky FS-i6X Simulator', mapping: '', expectedSource: 'transmitter' as const },
    { id: 'Jumper T-Pro EdgeTX', mapping: '', expectedSource: 'transmitter' as const },
    { id: 'Generic USB Gamepad', mapping: '', expectedSource: 'gamepad' as const },
  ];
  const actions: Array<{ action: BindableAction; btn: number }> = [
    { action: 'brake', btn: 0 },
    { action: 'recover', btn: 1 },
    { action: 'changeCamera', btn: 2 },
    { action: 'techTimeout', btn: 3 },
    { action: 'skipGate', btn: 5 },
    { action: 'togglePause', btn: 9 },
  ];

  withMockEnvironment(({ setPads }) => {
    for (let pass = 1; pass <= 3; pass++) {
      for (const dev of devices) {
        for (const mode of ['single_stick', 'tank_dual_stick'] as const) {
          const ctrl = new UniversalController({ mode });
          const profAxes = [0, 0, 0, 0, -1, -1, -1, -1];
          setPads([makeGamepad({ id: dev.id, mapping: dev.mapping, axes: profAxes })]);
          ctrl.poll();

          const p = ctrl.getCurrentProfile();
          const fwdAxes = [...profAxes];
          if (mode === 'single_stick') {
            fwdAxes[p.throttleAxis] = -0.85;
            fwdAxes[p.steeringAxis] = -0.35;
          } else {
            fwdAxes[p.leftTrackAxis] = -0.85;
            fwdAxes[p.rightTrackAxis] = -0.85;
          }

          setPads([makeGamepad({ id: dev.id, mapping: dev.mapping, axes: fwdAxes })]);
          const driveOut = ctrl.poll();
          assert.equal(driveOut.source, dev.expectedSource, `Pass ${pass} ${dev.id} ${mode}`);
          assert.ok(Number.isFinite(driveOut.leftTrack) && Math.abs(driveOut.leftTrack) <= 1);
          assert.ok(Number.isFinite(driveOut.rightTrack) && Math.abs(driveOut.rightTrack) <= 1);
          assert.ok(driveOut.leftTrack > 0.25 && driveOut.rightTrack > 0.25, `Pass ${pass} ${dev.id} ${mode} should drive fwd`);

          // Verify every single action trigger on top of neutral/rest
          for (const a of actions) {
            setPads([makeGamepad({ id: dev.id, mapping: dev.mapping, axes: profAxes, pressed: [a.btn] })]);
            const actOut = ctrl.poll();
            assert.equal(actOut[a.action], true, `Pass ${pass} ${dev.id} ${mode} action ${a.action} failed`);
            setPads([makeGamepad({ id: dev.id, mapping: dev.mapping, axes: profAxes, pressed: [] })]);
            ctrl.poll();
          }

          // Verify keyboard W+A override during active controller
          ctrl.handleKeyDown('KeyW');
          ctrl.handleKeyDown('KeyA');
          const kbOut = ctrl.poll();
          assert.equal(kbOut.source, 'keyboard');
          assert.ok(kbOut.rightTrack > kbOut.leftTrack);
          ctrl.handleKeyUp('KeyW');
          ctrl.handleKeyUp('KeyA');
        }
      }
    }
  });
});
