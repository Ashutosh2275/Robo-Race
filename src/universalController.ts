import {
  keyboardKeysFromCodes,
  keyboardTrackCommands,
  mixThrottleSteering,
  pivotTrackCommands,
  resolveKeyboardAxes,
  type ControlTuning,
  type KeyboardKeys,
  type TrackCommands,
  type NormalizedDriveInput,
} from './driveControls.ts';

export type ControllerMode = 'single_stick' | 'tank_dual_stick';

export interface DeviceProfile {
  id: string;
  name: string;
  type: 'gamepad' | 'transmitter_radiomaster' | 'transmitter_flysky' | 'transmitter_jumper' | 'generic';
  throttleAxis: number;
  steeringAxis: number;
  leftTrackAxis: number;
  rightTrackAxis: number;
  invertThrottle: boolean;
  invertSteering: boolean;
  deadzone: number;     // 0.0 to 0.25
  expo: number;         // 0.0 to 0.6
  sensitivity: number;  // 0.4 to 1.6
  centerOffsetThrottle: number;
  centerOffsetSteering: number;
}

export type ControllerConfig = {
  mode: ControllerMode;
  deadzone: number;     // 0.0 to 0.25
  expo: number;         // 0.0 to 0.6
  sensitivity: number;  // 0.4 to 1.6
  invertThrottle: boolean;
  invertSteering: boolean;
  failsafeTimeoutMs?: number;
};

export type ControllerOutputs = {
  source: 'keyboard' | 'gamepad' | 'transmitter' | 'touch' | 'mouse' | 'neutral';
  deviceName: string;
  leftTrack: number;
  rightTrack: number;
  throttle: number;
  steering: number;
  brake: boolean;
  recover: boolean;
  changeCamera: boolean;
  togglePause: boolean;
  normalizedInput?: NormalizedDriveInput;
  failsafeActive?: boolean;
};

export interface ControllerDiagnostics {
  source: string;
  deviceName: string;
  profileName: string;
  rawAxes: number[];
  rawButtons: boolean[];
  normalizedThrottle: number;
  normalizedSteering: number;
  semanticSteering: number; // +1 LEFT, -1 RIGHT
  semanticThrottle: number; // +1 FWD, -1 REV
  leftTrackCommand: number;
  rightTrackCommand: number;
  directionLabel: 'LEFT' | 'RIGHT' | 'CENTER';
  throttleLabel: 'FORWARD' | 'REVERSE' | 'NEUTRAL';
  isBraking: boolean;
  failsafeActive: boolean;
}

export const PREDEFINED_PROFILES: DeviceProfile[] = [
  {
    id: 'default_gamepad',
    name: 'Standard Gamepad (Xbox / PlayStation)',
    type: 'gamepad',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 1,
    rightTrackAxis: 3,
    invertThrottle: false,
    invertSteering: false,
    deadzone: 0.08,
    expo: 0.20,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
  },
  {
    id: 'radiomaster_boxer',
    name: 'RadioMaster Boxer / TX16S / Pocket (EdgeTX)',
    type: 'transmitter_radiomaster',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 1,
    rightTrackAxis: 3,
    invertThrottle: false,
    invertSteering: false,
    deadzone: 0.04,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
  },
  {
    id: 'flysky_fsi6x',
    name: 'FlySky FS-i6X / FS-i6 (USB Adapter)',
    type: 'transmitter_flysky',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 1,
    rightTrackAxis: 3,
    invertThrottle: false,
    invertSteering: false,
    deadzone: 0.05,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
  },
  {
    id: 'jumper_tpro',
    name: 'Jumper T-Pro / T-Lite (OpenTX/EdgeTX)',
    type: 'transmitter_jumper',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 1,
    rightTrackAxis: 3,
    invertThrottle: false,
    invertSteering: false,
    deadzone: 0.04,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
  },
];

export class UniversalController {
  private config: ControllerConfig;
  private tuning: ControlTuning;
  private keyboardCodes = new Set<string>();
  private touchLeft = { x: 0, y: 0, active: false };
  private touchRight = { x: 0, y: 0, active: false };
  private mouseLeft = 0;
  private mouseRight = 0;
  private mouseActive = false;
  private gamepadIndex: number | null = null;
  private lastGamepadTimestamp = 0;
  private lastActiveTimestamp = performance.now();
  private failsafeActive = false;
  private prevButtonStates = { brake: false, recover: false, camera: false, pause: false };

  private activeProfile: DeviceProfile = {
    id: 'default_gamepad',
    name: 'Standard Gamepad (Xbox/PlayStation)',
    type: 'gamepad',
    throttleAxis: 1,
    steeringAxis: 0,
    leftTrackAxis: 1,
    rightTrackAxis: 3,
    invertThrottle: false,
    invertSteering: false,
    deadzone: 0.08,
    expo: 0.20,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
  };

  private latestDiagnostics: ControllerDiagnostics = {
    source: 'neutral',
    deviceName: 'None',
    profileName: 'Generic Gamepad',
    rawAxes: [],
    rawButtons: [],
    normalizedThrottle: 0,
    normalizedSteering: 0,
    semanticSteering: 0,
    semanticThrottle: 0,
    leftTrackCommand: 0,
    rightTrackCommand: 0,
    directionLabel: 'CENTER',
    throttleLabel: 'NEUTRAL',
    isBraking: false,
    failsafeActive: false,
  };

  constructor(
    config: Partial<ControllerConfig> = {},
    tuning: Partial<ControlTuning> = {}
  ) {
    this.config = {
      mode: 'single_stick',
      invertSteering: false,
      invertThrottle: false,
      deadzone: 0.05,
      expo: 0.2,
      sensitivity: 1.0,
      failsafeTimeoutMs: 350,
      ...config,
    };
    this.tuning = {
      forwardSensitivity: 1.0,
      reverseSensitivity: 1.0,
      steeringSensitivity: 0.65,
      pivotSensitivity: 0.50,
      ...tuning,
    };
    this.setupListeners();
  }

  public updateConfig(newConfig: Partial<ControllerConfig>) {
    Object.assign(this.config, newConfig);
    if (newConfig.invertSteering !== undefined) this.activeProfile.invertSteering = newConfig.invertSteering;
    if (newConfig.invertThrottle !== undefined) this.activeProfile.invertThrottle = newConfig.invertThrottle;
    if (newConfig.deadzone !== undefined) this.activeProfile.deadzone = newConfig.deadzone;
    if (newConfig.expo !== undefined) this.activeProfile.expo = newConfig.expo;
    if (newConfig.sensitivity !== undefined) this.activeProfile.sensitivity = newConfig.sensitivity;
    this.saveCurrentProfile();
  }

  public updateTuning(newTuning: Partial<ControlTuning>) {
    Object.assign(this.tuning, newTuning);
  }

  public getDiagnostics(): ControllerDiagnostics {
    return this.latestDiagnostics;
  }

  public getCurrentProfile(): DeviceProfile {
    return { ...this.activeProfile };
  }

  public getConfig(): ControllerConfig {
    return { ...this.config };
  }

  public getBuiltinProfiles(): DeviceProfile[] {
    return [...PREDEFINED_PROFILES];
  }

  public selectProfileById(id: string) {
    const found = PREDEFINED_PROFILES.find(p => p.id === id);
    if (found) {
      this.activeProfile = { ...found };
      const saved = this.loadSavedProfile(id);
      if (saved) Object.assign(this.activeProfile, saved);
    }
  }

  public setAxisMapping(type: 'steering' | 'throttle' | 'leftTrack' | 'rightTrack', axisIndex: number) {
    if (type === 'steering') this.activeProfile.steeringAxis = axisIndex;
    else if (type === 'throttle') this.activeProfile.throttleAxis = axisIndex;
    else if (type === 'leftTrack') this.activeProfile.leftTrackAxis = axisIndex;
    else if (type === 'rightTrack') this.activeProfile.rightTrackAxis = axisIndex;
    this.saveCurrentProfile();
  }

  public toggleInvert(type: 'steering' | 'throttle') {
    if (type === 'steering') {
      this.activeProfile.invertSteering = !this.activeProfile.invertSteering;
      this.config.invertSteering = this.activeProfile.invertSteering;
    } else {
      this.activeProfile.invertThrottle = !this.activeProfile.invertThrottle;
      this.config.invertThrottle = this.activeProfile.invertThrottle;
    }
    this.saveCurrentProfile();
  }

  public calibrateCenter() {
    if (this.gamepadIndex !== null && typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp) {
        const rawThr = -(gp.axes[this.activeProfile.throttleAxis] ?? 0);
        const rawStr = -(gp.axes[this.activeProfile.steeringAxis] ?? 0);
        this.activeProfile.centerOffsetThrottle = rawThr;
        this.activeProfile.centerOffsetSteering = rawStr;
        this.saveCurrentProfile();
      }
    }
  }

  public setDeviceProfile(profile: Partial<DeviceProfile>) {
    Object.assign(this.activeProfile, profile);
    this.saveCurrentProfile();
  }

  private saveCurrentProfile() {
    try {
      localStorage.setItem(`robo-race-profile-${this.activeProfile.id}`, JSON.stringify(this.activeProfile));
    } catch {}
  }

  private loadSavedProfile(id: string): Partial<DeviceProfile> | null {
    try {
      const data = localStorage.getItem(`robo-race-profile-${id}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  private detectAndConfigureDevice(gp: Gamepad): DeviceProfile {
    const id = gp.id || 'Generic Gamepad';
    const lower = id.toLowerCase();

    let type: DeviceProfile['type'] = 'gamepad';
    let throttleAxis = 1;
    let steeringAxis = 0;
    let leftTrackAxis = 1;
    let rightTrackAxis = gp.axes.length > 3 ? 3 : 2;

    if (/radiomaster|boxer|tx16s|pocket|zorro/i.test(lower)) {
      type = 'transmitter_radiomaster';
      // EdgeTX / OpenTX multi-axis: Axis 0 = Ail, 1 = Ele, 2 = Thr, 3 = Rud
      steeringAxis = 0;
      throttleAxis = 1;
      leftTrackAxis = 1;
      rightTrackAxis = gp.axes.length > 3 ? 3 : 2;
    } else if (/flysky|fs-i6|fs-i6x|ibus|ppm/i.test(lower)) {
      type = 'transmitter_flysky';
      steeringAxis = 0;
      throttleAxis = 1;
      leftTrackAxis = 1;
      rightTrackAxis = 3;
    } else if (/edgetx|opentx|jumper|frsky/i.test(lower)) {
      type = 'transmitter_jumper';
      steeringAxis = 0;
      throttleAxis = 1;
      leftTrackAxis = 1;
      rightTrackAxis = 3;
    }

    const baseProfile: DeviceProfile = {
      id: id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 32),
      name: id,
      type,
      throttleAxis,
      steeringAxis,
      leftTrackAxis,
      rightTrackAxis,
      invertThrottle: this.config.invertThrottle,
      invertSteering: this.config.invertSteering,
      deadzone: this.config.deadzone,
      expo: this.config.expo,
      sensitivity: this.config.sensitivity,
      centerOffsetThrottle: 0,
      centerOffsetSteering: 0,
    };

    const saved = this.loadSavedProfile(baseProfile.id);
    if (saved) Object.assign(baseProfile, saved);

    this.activeProfile = baseProfile;
    return baseProfile;
  }

  private setupListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.gamepadIndex = e.gamepad.index;
      this.detectAndConfigureDevice(e.gamepad);
      this.failsafeActive = false;
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.failsafeActive = true;
        this.neutralize();
      }
    });

    window.addEventListener('blur', () => this.neutralize());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.neutralize();
      });
    }
  }

  public handleKeyDown(code: string) {
    this.keyboardCodes.add(code);
    this.failsafeActive = false;
  }

  public handleKeyUp(code: string) {
    this.keyboardCodes.delete(code);
  }

  public setTouchStick(side: 'left' | 'right', x: number, y: number, active: boolean) {
    if (side === 'left') {
      this.touchLeft = { x, y, active };
    } else {
      this.touchRight = { x, y, active };
    }
    this.failsafeActive = false;
  }

  public setMouseTrack(left: number, right: number, active: boolean) {
    this.mouseLeft = left;
    this.mouseRight = right;
    this.mouseActive = active;
    this.failsafeActive = false;
  }

  public neutralize() {
    this.keyboardCodes.clear();
    this.touchLeft.active = false;
    this.touchRight.active = false;
    this.touchLeft.x = this.touchLeft.y = 0;
    this.touchRight.x = this.touchRight.y = 0;
    this.mouseActive = false;
    this.mouseLeft = this.mouseRight = 0;
  }

  private applyDeadzoneAndExpo(val: number, deadzone = this.config.deadzone, expo = this.config.expo): number {
    const mag = Math.abs(val);
    if (mag < deadzone) return 0;
    const scaled = (mag - deadzone) / (1 - deadzone);
    // Standard cubic RC expo curve: expo * x^3 + (1 - expo) * x
    const shaped = expo * Math.pow(scaled, 3) + (1 - expo) * scaled;
    return Math.sign(val) * shaped;
  }

  public sample(gamepad: any): ControllerOutputs {
    this.detectAndConfigureDevice(gamepad);
    return this.poll(gamepad);
  }

  public poll(gamepadOverride?: any): ControllerOutputs {
    const outputs: ControllerOutputs = {
      source: 'neutral',
      deviceName: 'None',
      leftTrack: 0,
      rightTrack: 0,
      throttle: 0,
      steering: 0,
      brake: false,
      recover: false,
      changeCamera: false,
      togglePause: false,
      failsafeActive: this.failsafeActive,
    };

    // 1. Check Keyboard Priority (W/S/A/T/D/B/Arrows/Space/R/C/Esc)
    const activeKeySet = this.keyboardCodes;
    const hasKeyboardDrive = ['KeyW', 'KeyS', 'KeyA', 'KeyT', 'KeyD', 'KeyB', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => activeKeySet.has(k));
    const isBrakingKey = activeKeySet.has('Space');

    if (hasKeyboardDrive || isBrakingKey) {
      outputs.source = 'keyboard';
      outputs.deviceName = 'Keyboard (W/S/A/T/D)';
      const keys = keyboardKeysFromCodes(activeKeySet);
      const { throttle, steering } = resolveKeyboardAxes(keys);

      const scaledThrottle = throttle * (throttle < 0 ? this.tuning.reverseSensitivity : this.tuning.forwardSensitivity) * this.config.sensitivity;
      const isPivot = throttle === 0 && steering !== 0;
      const steerSensitivity = (isPivot ? this.tuning.pivotSensitivity : this.tuning.steeringSensitivity) * this.config.sensitivity;

      // Canonical differential mix: vL = v - s*k, vR = v + s*k
      const cmds = mixThrottleSteering(scaledThrottle, steering, steerSensitivity);

      outputs.leftTrack = isBrakingKey ? 0 : cmds.left;
      outputs.rightTrack = isBrakingKey ? 0 : cmds.right;
      outputs.throttle = throttle;
      outputs.steering = steering; // canonical: +1 LEFT, -1 RIGHT
      outputs.brake = isBrakingKey;

      this.updateDiagnostics(outputs, [], [], throttle, steering);
      return outputs;
    }

    // 2. Check Gamepad / RC Transmitter (RadioMaster, Boxer, FlySky, EdgeTX, Xbox, PS)
    const gp = gamepadOverride || (this.gamepadIndex !== null && typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads()[this.gamepadIndex] : null);
    if (gp && ('connected' in gp ? gp.connected : true)) {
        const profile = this.activeProfile;
        const rawAxes: number[] = Array.from(gp.axes).map(Number);
        const rawButtons: boolean[] = Array.from(gp.buttons).map((b: any) => Boolean(b.pressed));

        // Failsafe watchdog: check for frozen timestamp
        if (gp.timestamp && gp.timestamp === this.lastGamepadTimestamp) {
          // Hardware or browser stalled
          if (performance.now() - this.lastActiveTimestamp > 350) {
            this.failsafeActive = true;
            outputs.failsafeActive = true;
            outputs.brake = true;
            return outputs;
          }
        } else {
          this.lastGamepadTimestamp = gp.timestamp || performance.now();
          this.lastActiveTimestamp = performance.now();
          this.failsafeActive = false;
        }

        const isTransmitter = profile.type.startsWith('transmitter');
        outputs.source = isTransmitter ? 'transmitter' : 'gamepad';
        outputs.deviceName = profile.name;

        // Buttons
        const btnBrake = gp.buttons[0]?.pressed ?? false;      // Brake
        const btnRecover = gp.buttons[1]?.pressed ?? false;    // Recover
        const btnCamera = gp.buttons[2]?.pressed ?? false;     // Camera
        const btnPause = gp.buttons[9]?.pressed ?? false;      // Pause / Menu

        outputs.brake = btnBrake;
        outputs.recover = btnRecover && !this.prevButtonStates.recover;
        outputs.changeCamera = btnCamera && !this.prevButtonStates.camera;
        outputs.togglePause = btnPause && !this.prevButtonStates.pause;

        this.prevButtonStates.recover = btnRecover;
        this.prevButtonStates.camera = btnCamera;
        this.prevButtonStates.pause = btnPause;

        let left = 0;
        let right = 0;
        let semanticThrottle = 0;
        let semanticSteering = 0;

        if (this.config.mode === 'tank_dual_stick') {
          // Direct tank mode: left stick Y -> left track, right stick Y -> right track
          // Standard gamepad Y axis is negative when pushed forward
          let rawLeftY = -(gp.axes[profile.leftTrackAxis] ?? 0);
          let rawRightY = -(gp.axes[profile.rightTrackAxis] ?? 0);

          if (this.config.invertThrottle || profile.invertThrottle) {
            rawLeftY = -rawLeftY;
            rawRightY = -rawRightY;
          }

          left = this.applyDeadzoneAndExpo(rawLeftY - profile.centerOffsetThrottle, profile.deadzone, profile.expo);
          right = this.applyDeadzoneAndExpo(rawRightY - profile.centerOffsetThrottle, profile.deadzone, profile.expo);

          left *= this.config.sensitivity * profile.sensitivity;
          right *= this.config.sensitivity * profile.sensitivity;

          semanticThrottle = (left + right) * 0.5;
          // If right track is driving faster forward than left, the vehicle turns LEFT (positive semantic steering)
          semanticSteering = (right - left) * 0.5;
        } else {
          // Single-stick mode:
          // Throttle: stick pushed UP is negative raw axis -> invert so forward is +1
          let rawThrottle = -(gp.axes[profile.throttleAxis] ?? 0);
          if (this.config.invertThrottle || profile.invertThrottle) rawThrottle = -rawThrottle;
          semanticThrottle = this.applyDeadzoneAndExpo(rawThrottle - profile.centerOffsetThrottle, profile.deadzone, profile.expo);

          // Steering:
          // In standard Gamepad API, stick pushed LEFT is negative raw axis (-1.0).
          // Our CANONICAL SEMANTIC STEERING requires: LEFT = +1.0, RIGHT = -1.0.
          // Therefore: raw stick LEFT (-1.0) maps to semantic LEFT (+1.0) via (-rawSteer).
          let rawSteering = -(gp.axes[profile.steeringAxis] ?? 0);
          if (this.config.invertSteering || profile.invertSteering) rawSteering = -rawSteering;
          semanticSteering = this.applyDeadzoneAndExpo(rawSteering - profile.centerOffsetSteering, profile.deadzone, profile.expo);

          // Canonical differential mix: vL = v - s*k, vR = v + s*k
          const isPivot = Math.abs(semanticThrottle) < 0.05 && Math.abs(semanticSteering) > 0.05;
          const steerMix = (isPivot ? this.tuning.pivotSensitivity : this.tuning.steeringSensitivity) * this.config.sensitivity;
          const mixed = mixThrottleSteering(semanticThrottle, semanticSteering, steerMix);

          left = mixed.left;
          right = mixed.right;
        }

        if (Math.abs(left) > 0.01 || Math.abs(right) > 0.01 || btnBrake) {
          outputs.leftTrack = btnBrake ? 0 : Math.max(-1, Math.min(1, left));
          outputs.rightTrack = btnBrake ? 0 : Math.max(-1, Math.min(1, right));
          outputs.throttle = semanticThrottle;
          outputs.steering = semanticSteering;

          this.updateDiagnostics(outputs, rawAxes, rawButtons, semanticThrottle, semanticSteering);
          return outputs;
        }
      }

    // 3. Check Virtual Touch Joysticks (Mobile / Tablet)
    if (this.touchLeft.active || this.touchRight.active) {
      outputs.source = 'touch';
      outputs.deviceName = 'Touch Virtual Joystick';

      if (this.config.mode === 'tank_dual_stick') {
        const leftVal = this.applyDeadzoneAndExpo(this.touchLeft.y);
        const rightVal = this.applyDeadzoneAndExpo(this.touchRight.y);
        outputs.leftTrack = Math.max(-1, Math.min(1, leftVal * this.config.sensitivity));
        outputs.rightTrack = Math.max(-1, Math.min(1, rightVal * this.config.sensitivity));
        outputs.throttle = (outputs.leftTrack + outputs.rightTrack) * 0.5;
        outputs.steering = (outputs.rightTrack - outputs.leftTrack) * 0.5;
      } else {
        const rawThr = this.touchLeft.active ? this.touchLeft.y : this.touchRight.y;
        // In touch UI: dragged LEFT produces negative x.
        // Semantic steering: LEFT is +1.0. So semanticSteer = -rawSteer.
        const rawSteer = this.touchRight.active ? -this.touchRight.x : -this.touchLeft.x;

        const thr = this.applyDeadzoneAndExpo(rawThr);
        const steer = this.applyDeadzoneAndExpo(rawSteer);

        const mixed = mixThrottleSteering(thr, steer, this.tuning.steeringSensitivity * this.config.sensitivity);
        outputs.leftTrack = mixed.left;
        outputs.rightTrack = mixed.right;
        outputs.throttle = thr;
        outputs.steering = steer;
      }

      this.updateDiagnostics(outputs, [], [], outputs.throttle, outputs.steering);
      return outputs;
    }

    // 4. Check Mouse Drag Virtual Joystick
    if (this.mouseActive) {
      outputs.source = 'mouse';
      outputs.deviceName = 'Mouse Virtual Track';
      outputs.leftTrack = Math.max(-1, Math.min(1, this.mouseLeft));
      outputs.rightTrack = Math.max(-1, Math.min(1, this.mouseRight));
      outputs.throttle = (outputs.leftTrack + outputs.rightTrack) * 0.5;
      outputs.steering = (outputs.rightTrack - outputs.leftTrack) * 0.5;
      this.updateDiagnostics(outputs, [], [], outputs.throttle, outputs.steering);
      return outputs;
    }

    this.updateDiagnostics(outputs, [], [], 0, 0);
    return outputs;
  }

  private updateDiagnostics(
    outputs: ControllerOutputs,
    rawAxes: number[],
    rawButtons: boolean[],
    throttle: number,
    steering: number
  ) {
    this.latestDiagnostics = {
      source: outputs.source,
      deviceName: outputs.deviceName,
      profileName: this.activeProfile.name,
      rawAxes,
      rawButtons,
      normalizedThrottle: throttle,
      normalizedSteering: steering,
      semanticSteering: steering,
      semanticThrottle: throttle,
      leftTrackCommand: outputs.leftTrack,
      rightTrackCommand: outputs.rightTrack,
      directionLabel: steering > 0.05 ? 'LEFT' : steering < -0.05 ? 'RIGHT' : 'CENTER',
      throttleLabel: throttle > 0.05 ? 'FORWARD' : throttle < -0.05 ? 'REVERSE' : 'NEUTRAL',
      isBraking: outputs.brake,
      failsafeActive: outputs.failsafeActive ?? false,
    };
  }
}
