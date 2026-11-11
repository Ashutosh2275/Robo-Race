import {
  keyboardKeysFromCodes,
  keyboardTrackCommands,
  mixThrottleSteering,
  resolveKeyboardAxes,
  type ControlTuning,
  type KeyboardKeys,
  type TrackCommands,
  type NormalizedDriveInput,
} from './driveControls.ts';

export type ControllerMode = 'single_stick' | 'tank_dual_stick';

export type BindableAction =
  | 'brake'
  | 'recover'
  | 'changeCamera'
  | 'togglePause'
  | 'skipGate'
  | 'techTimeout';

export type InputTriggerBinding =
  | { kind: 'button'; index: number }
  | { kind: 'axis'; index: number; threshold: number; direction: 'high' | 'low' }
  | { kind: 'none' };

export type ControllerActionBindings = Record<BindableAction, InputTriggerBinding>;

export interface AxisCalibration {
  min: number;
  center: number;
  max: number;
}

export interface ConnectedDeviceSummary {
  index: number;
  id: string;
  mapping: string;
  axesCount: number;
  buttonsCount: number;
  connected: boolean;
  type: DeviceProfile['type'];
}

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
  invertLeftTrack?: boolean;
  invertRightTrack?: boolean;
  enableTriggerDrive: boolean;
  deadzone: number;     // 0.0 to 0.25
  expo: number;         // 0.0 to 0.6
  sensitivity: number;  // 0.4 to 1.6
  centerOffsetThrottle: number;
  centerOffsetSteering: number;
  axisCalibrations: Record<number, AxisCalibration>;
  bindings: ControllerActionBindings;
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
  skipGate: boolean;
  techTimeout: boolean;
  normalizedInput?: NormalizedDriveInput;
  failsafeActive?: boolean;
};

export interface ControllerDiagnostics {
  source: string;
  deviceName: string;
  profileName: string;
  activeDeviceIndex: number | null;
  connectedDevices: ConnectedDeviceSummary[];
  rawAxes: number[];
  calibratedAxes: number[];
  rawButtons: boolean[];
  rawButtonValues: number[];
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
  calibrationWizard: {
    activeSweep: boolean;
    waitingAxisTarget: AxisCaptureTarget | null;
    waitingBindingAction: BindableAction | null;
  };
}

export type AxisCaptureTarget =
  | 'throttle_fwd'
  | 'steering_left'
  | 'left_track_fwd'
  | 'right_track_fwd';

export function createDefaultBindings(): ControllerActionBindings {
  return {
    brake: { kind: 'button', index: 0 },
    recover: { kind: 'button', index: 1 },
    changeCamera: { kind: 'button', index: 2 },
    techTimeout: { kind: 'button', index: 3 },
    skipGate: { kind: 'button', index: 5 },
    togglePause: { kind: 'button', index: 9 },
  };
}

function defaultCalibrations(): Record<number, AxisCalibration> {
  const map: Record<number, AxisCalibration> = {};
  for (let i = 0; i < 8; i++) {
    map[i] = { min: -1, center: 0, max: 1 };
  }
  return map;
}

/**
 * Normalizes a raw hardware axis reading in [-1, 1] using per-axis asymmetric endpoint
 * and trim-center calibration: resting trim maps to 0.00, full negative throw to -1.00,
 * and full positive throw to +1.00 before polarity inversion.
 */
export function normalizeCalibratedAxis(rawVal: number, cal?: AxisCalibration): number {
  const safeRaw = Number.isFinite(rawVal) ? Math.max(-1.05, Math.min(1.05, rawVal)) : 0;
  if (!cal) return Math.max(-1, Math.min(1, safeRaw));
  const center = Math.max(-0.85, Math.min(0.85, cal.center));
  if (safeRaw >= center) {
    const posSpan = Math.max(0.15, cal.max - center);
    return Math.max(0, Math.min(1, (safeRaw - center) / posSpan));
  }
  const negSpan = Math.max(0.15, center - cal.min);
  return Math.max(-1, Math.min(0, (safeRaw - center) / negSpan));
}

export function classifyHardwareDevice(id: string, mapping = ''): DeviceProfile['type'] {
  const lower = (id || '').toLowerCase();
  if (/(radiomaster|boxer|tx16|tx12|pocket|zorro|mt12)/i.test(lower)) {
    return 'transmitter_radiomaster';
  }
  if (/(flysky|fs-?i6|fs-?st8|fs-?sm600|pl18|ibus|ppm|vjoy)/i.test(lower)) {
    return 'transmitter_flysky';
  }
  if (/(edgetx|opentx|jumper|t-?pro|t-?lite|frsky|taranis|qx7|x-?lite|betafpv|literadio)/i.test(lower)) {
    return 'transmitter_jumper';
  }
  if (
    mapping === 'standard' ||
    /(xbox|xinput|dualshock|dualsense|playstation|sony|wireless controller|logitech|8bitdo|nintendo|switch pro|gamepad)/i.test(lower)
  ) {
    return 'gamepad';
  }
  return 'generic';
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
    enableTriggerDrive: true,
    deadzone: 0.08,
    expo: 0.20,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
    axisCalibrations: defaultCalibrations(),
    bindings: createDefaultBindings(),
  },
  {
    id: 'radiomaster_boxer',
    name: 'RadioMaster Boxer / TX16S / Pocket (EdgeTX)',
    type: 'transmitter_radiomaster',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 2,
    rightTrackAxis: 1,
    invertThrottle: false,
    invertSteering: false,
    enableTriggerDrive: false,
    deadzone: 0.04,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
    axisCalibrations: defaultCalibrations(),
    bindings: createDefaultBindings(),
  },
  {
    id: 'flysky_fsi6x',
    name: 'FlySky FS-i6X / FS-i6 (USB Adapter)',
    type: 'transmitter_flysky',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 2,
    rightTrackAxis: 1,
    invertThrottle: false,
    invertSteering: false,
    enableTriggerDrive: false,
    deadzone: 0.06,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
    axisCalibrations: defaultCalibrations(),
    bindings: createDefaultBindings(),
  },
  {
    id: 'jumper_tpro',
    name: 'Jumper T-Pro / FrSky / OpenTX',
    type: 'transmitter_jumper',
    steeringAxis: 0,
    throttleAxis: 1,
    leftTrackAxis: 2,
    rightTrackAxis: 1,
    invertThrottle: false,
    invertSteering: false,
    enableTriggerDrive: false,
    deadzone: 0.04,
    expo: 0.15,
    sensitivity: 1.0,
    centerOffsetThrottle: 0,
    centerOffsetSteering: 0,
    axisCalibrations: defaultCalibrations(),
    bindings: createDefaultBindings(),
  },
];

function cloneProfile(p: DeviceProfile): DeviceProfile {
  return {
    ...p,
    axisCalibrations: Object.fromEntries(
      Object.entries(p.axisCalibrations || defaultCalibrations()).map(([k, v]) => [k, { ...v }])
    ),
    bindings: {
      ...createDefaultBindings(),
      ...Object.fromEntries(Object.entries(p.bindings || {}).map(([k, v]) => [k, { ...v }])),
    } as ControllerActionBindings,
  };
}

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
  private suppressedIndices = new Set<number>();
  private lastScannedAxesByIndex = new Map<number, number[]>();
  private failsafeActive = false;
  private prevActionStates: Record<BindableAction, boolean> = {
    brake: false,
    recover: false,
    changeCamera: false,
    togglePause: false,
    skipGate: false,
    techTimeout: false,
  };

  // Interactive calibration capture state
  private sweepActive = false;
  private sweepAxes: Record<number, AxisCalibration> = {};
  private waitingAxisTarget: AxisCaptureTarget | null = null;
  private axisCaptureBaseline: number[] = [];
  private waitingBindingAction: BindableAction | null = null;
  private bindingCaptureBaselineAxes: number[] = [];
  private bindingCaptureBaselineButtons: boolean[] = [];

  private deviceCallbacks: Array<(event: 'connected' | 'disconnected' | 'switched' | 'calibrated', detail: string) => void> = [];

  private activeProfile: DeviceProfile = cloneProfile(PREDEFINED_PROFILES[0]);

  private latestDiagnostics: ControllerDiagnostics = {
    source: 'neutral',
    deviceName: 'None',
    profileName: 'Standard Gamepad (Xbox / PlayStation)',
    activeDeviceIndex: null,
    connectedDevices: [],
    rawAxes: [],
    calibratedAxes: [],
    rawButtons: [],
    rawButtonValues: [],
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
    calibrationWizard: {
      activeSweep: false,
      waitingAxisTarget: null,
      waitingBindingAction: null,
    },
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

  public onDeviceEvent(cb: (event: 'connected' | 'disconnected' | 'switched' | 'calibrated', detail: string) => void) {
    this.deviceCallbacks.push(cb);
  }

  private emitDeviceEvent(event: 'connected' | 'disconnected' | 'switched' | 'calibrated', detail: string) {
    for (const cb of this.deviceCallbacks) {
      try { cb(event, detail); } catch {}
    }
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
    return cloneProfile(this.activeProfile);
  }

  public getConfig(): ControllerConfig {
    return { ...this.config };
  }

  public getBuiltinProfiles(): DeviceProfile[] {
    return PREDEFINED_PROFILES.map(cloneProfile);
  }

  public selectProfileById(id: string) {
    const found = PREDEFINED_PROFILES.find(p => p.id === id);
    if (found) {
      const next = cloneProfile(found);
      const saved = this.loadSavedProfile(id);
      if (saved) this.mergeSavedProfile(next, saved);
      this.activeProfile = next;
      this.syncConfigFromActiveProfile();
      this.latestDiagnostics.profileName = this.activeProfile.name;
      this.emitDeviceEvent('switched', this.activeProfile.name);
    }
  }

  private syncConfigFromActiveProfile() {
    this.config.invertSteering = this.activeProfile.invertSteering;
    this.config.invertThrottle = this.activeProfile.invertThrottle;
    this.config.deadzone = this.activeProfile.deadzone;
    this.config.expo = this.activeProfile.expo;
    this.config.sensitivity = this.activeProfile.sensitivity;
  }

  public setAxisMapping(type: 'steering' | 'throttle' | 'leftTrack' | 'rightTrack', axisIndex: number) {
    const safeIdx = Math.max(0, Math.min(15, Math.floor(axisIndex)));
    if (type === 'steering') this.activeProfile.steeringAxis = safeIdx;
    else if (type === 'throttle') this.activeProfile.throttleAxis = safeIdx;
    else if (type === 'leftTrack') this.activeProfile.leftTrackAxis = safeIdx;
    else if (type === 'rightTrack') this.activeProfile.rightTrackAxis = safeIdx;
    if (!this.activeProfile.axisCalibrations[safeIdx]) {
      this.activeProfile.axisCalibrations[safeIdx] = { min: -1, center: 0, max: 1 };
    }
    this.saveCurrentProfile();
  }

  public toggleInvert(type: 'steering' | 'throttle' | 'leftTrack' | 'rightTrack') {
    if (type === 'steering') {
      this.activeProfile.invertSteering = !this.activeProfile.invertSteering;
      this.config.invertSteering = this.activeProfile.invertSteering;
    } else if (type === 'throttle') {
      this.activeProfile.invertThrottle = !this.activeProfile.invertThrottle;
      this.config.invertThrottle = this.activeProfile.invertThrottle;
    } else if (type === 'leftTrack') {
      this.activeProfile.invertLeftTrack = !this.activeProfile.invertLeftTrack;
    } else {
      this.activeProfile.invertRightTrack = !this.activeProfile.invertRightTrack;
    }
    this.saveCurrentProfile();
  }

  public setTriggerDrive(enabled: boolean) {
    this.activeProfile.enableTriggerDrive = enabled;
    this.saveCurrentProfile();
  }

  public setActionBinding(action: BindableAction, binding: InputTriggerBinding) {
    this.activeProfile.bindings[action] = { ...binding };
    this.saveCurrentProfile();
  }

  /**
   * Captures current resting raw axis positions as zero centers without invert distortion.
   */
  public calibrateCenter(gamepadOverride?: any): boolean {
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    if (!gp || !gp.axes) return false;
    const rawAxes: number[] = Array.from(gp.axes).map(Number);
    const axesToCenter = new Set<number>([
      this.activeProfile.throttleAxis,
      this.activeProfile.steeringAxis,
      this.activeProfile.leftTrackAxis,
      this.activeProfile.rightTrackAxis,
    ]);
    for (let g = 0; g < Math.min(4, rawAxes.length); g++) {
      axesToCenter.add(g);
    }
    for (const ax of axesToCenter) {
      if (ax < 0 || ax >= rawAxes.length) continue;
      const existing = this.activeProfile.axisCalibrations[ax] ?? { min: -1, center: 0, max: 1 };
      const rawCenter = Math.max(-0.85, Math.min(0.85, rawAxes[ax] ?? 0));
      this.activeProfile.axisCalibrations[ax] = {
        min: Math.min(existing.min, rawCenter - 0.15),
        center: rawCenter,
        max: Math.max(existing.max, rawCenter + 0.15),
      };
    }
    // Clear legacy scalar offsets (superseded by raw per-axis calibration)
    this.activeProfile.centerOffsetThrottle = 0;
    this.activeProfile.centerOffsetSteering = 0;
    this.failsafeActive = false;
    this.saveCurrentProfile();
    this.emitDeviceEvent('calibrated', `${this.activeProfile.name} center zeroed`);
    return true;
  }

  public startEndpointCalibration(gamepadOverride?: any) {
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    const rawAxes: number[] = gp?.axes ? Array.from(gp.axes).map(Number) : [];
    this.sweepAxes = {};
    for (let i = 0; i < Math.max(8, rawAxes.length); i++) {
      const existingCenter = this.activeProfile.axisCalibrations[i]?.center ?? (rawAxes[i] ?? 0);
      const val = rawAxes[i] ?? existingCenter;
      this.sweepAxes[i] = {
        min: val,
        center: Math.max(-0.85, Math.min(0.85, existingCenter)),
        max: val,
      };
    }
    this.sweepActive = true;
    this.waitingAxisTarget = null;
    this.waitingBindingAction = null;
  }

  public updateEndpointSweep(rawAxes: number[]) {
    if (!this.sweepActive) return;
    for (let i = 0; i < rawAxes.length; i++) {
      const v = rawAxes[i];
      if (!Number.isFinite(v)) continue;
      if (!this.sweepAxes[i]) {
        this.sweepAxes[i] = { min: v, center: v, max: v };
      } else {
        this.sweepAxes[i].min = Math.min(this.sweepAxes[i].min, v);
        this.sweepAxes[i].max = Math.max(this.sweepAxes[i].max, v);
      }
    }
  }

  public finishEndpointCalibration(gamepadOverride?: any): boolean {
    if (!this.sweepActive) return false;
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    const rawAxes: number[] = gp?.axes ? Array.from(gp.axes).map(Number) : [];
    for (let i = 0; i < Math.max(rawAxes.length, Object.keys(this.sweepAxes).length); i++) {
      const s = this.sweepAxes[i];
      const existing = this.activeProfile.axisCalibrations[i] ?? { min: -1, center: 0, max: 1 };
      if (!s) continue;
      const span = s.max - s.min;
      const curCenter = Number.isFinite(rawAxes[i]) ? Math.max(-0.85, Math.min(0.85, rawAxes[i])) : existing.center;
      if (span >= 0.35) {
        // Apply valid calibrated sweep limits, keeping center inside [min+0.12, max-0.12]
        const clampedCenter = Math.max(s.min + 0.12, Math.min(s.max - 0.12, curCenter));
        this.activeProfile.axisCalibrations[i] = {
          min: s.min,
          center: clampedCenter,
          max: s.max,
        };
      }
    }
    this.sweepActive = false;
    this.saveCurrentProfile();
    this.emitDeviceEvent('calibrated', `${this.activeProfile.name} endpoints calibrated`);
    return true;
  }

  public startAxisAutoBind(target: AxisCaptureTarget, gamepadOverride?: any) {
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    this.waitingAxisTarget = target;
    this.waitingBindingAction = null;
    this.sweepActive = false;
    this.axisCaptureBaseline = gp?.axes ? Array.from(gp.axes).map(Number) : [];
  }

  public startActionAutoBind(action: BindableAction, gamepadOverride?: any) {
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    this.waitingBindingAction = action;
    this.waitingAxisTarget = null;
    this.sweepActive = false;
    this.bindingCaptureBaselineAxes = gp?.axes ? Array.from(gp.axes).map(Number) : [];
    this.bindingCaptureBaselineButtons = gp?.buttons ? Array.from(gp.buttons).map((b: any) => Boolean(b?.pressed)) : [];
  }

  public cancelAutoBind() {
    this.waitingAxisTarget = null;
    this.waitingBindingAction = null;
    this.sweepActive = false;
  }

  private processInteractiveCaptures(rawAxes: number[], rawButtons: boolean[]): boolean {
    if (this.sweepActive) {
      this.updateEndpointSweep(rawAxes);
    }

    if (this.waitingAxisTarget) {
      let bestAxis = -1;
      let bestDelta = 0;
      for (let i = 0; i < rawAxes.length; i++) {
        const base = this.axisCaptureBaseline[i] ?? 0;
        const delta = rawAxes[i] - base;
        if (Math.abs(delta) > Math.abs(bestDelta)) {
          bestDelta = delta;
          bestAxis = i;
        }
      }
      if (bestAxis >= 0 && Math.abs(bestDelta) >= 0.32) {
        const cal = this.activeProfile.axisCalibrations[bestAxis] ?? { min: -1, center: 0, max: 1 };
        cal.center = Math.max(-0.85, Math.min(0.85, this.axisCaptureBaseline[bestAxis] ?? 0));
        this.activeProfile.axisCalibrations[bestAxis] = cal;
        // Negative raw deflection on push-forward/left is normal (no invert needed);
        // positive raw deflection means transmitter pushes positive -> invert!
        const needsInvert = bestDelta > 0;
        if (this.waitingAxisTarget === 'throttle_fwd') {
          this.activeProfile.throttleAxis = bestAxis;
          this.activeProfile.invertThrottle = needsInvert;
          this.config.invertThrottle = needsInvert;
        } else if (this.waitingAxisTarget === 'steering_left') {
          this.activeProfile.steeringAxis = bestAxis;
          this.activeProfile.invertSteering = needsInvert;
          this.config.invertSteering = needsInvert;
        } else if (this.waitingAxisTarget === 'left_track_fwd') {
          this.activeProfile.leftTrackAxis = bestAxis;
          this.activeProfile.invertLeftTrack =
            needsInvert !== Boolean(this.config.invertThrottle || this.activeProfile.invertThrottle);
        } else if (this.waitingAxisTarget === 'right_track_fwd') {
          this.activeProfile.rightTrackAxis = bestAxis;
          this.activeProfile.invertRightTrack =
            needsInvert !== Boolean(this.config.invertThrottle || this.activeProfile.invertThrottle);
        }
        const boundTarget = this.waitingAxisTarget;
        this.waitingAxisTarget = null;
        this.saveCurrentProfile();
        this.emitDeviceEvent('calibrated', `Bound ${boundTarget} -> Axis ${bestAxis}${needsInvert ? ' (Inv)' : ''}`);
        return true;
      }
    }

    if (this.waitingBindingAction) {
      for (let bi = 0; bi < rawButtons.length; bi++) {
        const was = this.bindingCaptureBaselineButtons[bi] ?? false;
        if (rawButtons[bi] && !was) {
          this.activeProfile.bindings[this.waitingBindingAction] = { kind: 'button', index: bi };
          const boundAct = this.waitingBindingAction;
          this.waitingBindingAction = null;
          this.saveCurrentProfile();
          this.emitDeviceEvent('calibrated', `Bound ${boundAct} -> Button ${bi}`);
          return true;
        }
      }
      // Also support RadioMaster/FlySky switch channels exposed as axes (e.g. Ch5..Ch8 jumping >= 0.55)
      for (let ai = 0; ai < rawAxes.length; ai++) {
        const base = this.bindingCaptureBaselineAxes[ai] ?? 0;
        const cur = rawAxes[ai];
        if (Math.abs(cur - base) >= 0.55 && Math.abs(cur) >= 0.45) {
          const dir: 'high' | 'low' = cur >= 0 ? 'high' : 'low';
          const threshold = cur >= 0 ? 0.4 : -0.4;
          this.activeProfile.bindings[this.waitingBindingAction] = { kind: 'axis', index: ai, threshold, direction: dir };
          const boundAct = this.waitingBindingAction;
          this.waitingBindingAction = null;
          this.saveCurrentProfile();
          this.emitDeviceEvent('calibrated', `Bound ${boundAct} -> Axis ${ai} Switch (${dir})`);
          return true;
        }
      }
    }
    return false;
  }

  public resetActiveCalibration() {
    const matchedBuiltin = PREDEFINED_PROFILES.find(p => p.type === this.activeProfile.type) ?? PREDEFINED_PROFILES[0];
    this.activeProfile.axisCalibrations = defaultCalibrations();
    this.activeProfile.steeringAxis = matchedBuiltin.steeringAxis;
    this.activeProfile.throttleAxis = matchedBuiltin.throttleAxis;
    this.activeProfile.leftTrackAxis = matchedBuiltin.leftTrackAxis;
    this.activeProfile.rightTrackAxis = matchedBuiltin.rightTrackAxis;
    this.activeProfile.invertSteering = matchedBuiltin.invertSteering;
    this.activeProfile.invertThrottle = matchedBuiltin.invertThrottle;
    this.activeProfile.invertLeftTrack = false;
    this.activeProfile.invertRightTrack = false;
    this.activeProfile.centerOffsetSteering = 0;
    this.activeProfile.centerOffsetThrottle = 0;
    this.activeProfile.bindings = createDefaultBindings();
    this.config.invertSteering = this.activeProfile.invertSteering;
    this.config.invertThrottle = this.activeProfile.invertThrottle;
    try {
      localStorage.removeItem(`robo-race-profile-${this.activeProfile.id}`);
    } catch {}
    this.emitDeviceEvent('calibrated', `Reset ${this.activeProfile.name} calibration`);
    this.latestDiagnostics.profileName = this.activeProfile.name;
  }

  public removeActiveDevice(): boolean {
    if (this.gamepadIndex === null) return false;
    this.suppressedIndices.add(this.gamepadIndex);
    for (const p of this.readBrowserGamepads()) {
      this.suppressedIndices.add(p.index);
    }
    const removedName = this.activeProfile.name;
    this.gamepadIndex = null;
    this.latestDiagnostics.activeDeviceIndex = null;
    this.latestDiagnostics.source = 'neutral';
    this.latestDiagnostics.deviceName = 'None';
    this.failsafeActive = false;
    this.cancelAutoBind();
    this.neutralize();
    this.resetPrevActions();
    this.emitDeviceEvent('disconnected', `${removedName} removed · Keyboard ready`);
    return true;
  }

  public selectDeviceIndex(index: number): boolean {
    const pads = this.readBrowserGamepads();
    const gp = pads.find(p => p.index === index && p.connected);
    if (!gp) return false;
    this.suppressedIndices.delete(index);
    this.gamepadIndex = index;
    this.detectAndConfigureDevice(gp);
    this.latestDiagnostics.activeDeviceIndex = this.gamepadIndex;
    this.latestDiagnostics.profileName = this.activeProfile.name;
    this.latestDiagnostics.deviceName = this.activeProfile.name;
    this.failsafeActive = false;
    this.emitDeviceEvent('switched', gp.id);
    return true;
  }

  public rescanDevices(): ConnectedDeviceSummary[] {
    this.suppressedIndices.clear();
    const pads = this.readBrowserGamepads();
    const connected = pads.filter(p => p && p.connected);
    if (connected.length > 0) {
      const preferred = connected.find(p => p.index === this.gamepadIndex) ?? connected[0];
      const changed = this.gamepadIndex !== preferred.index;
      this.gamepadIndex = preferred.index;
      this.detectAndConfigureDevice(preferred);
      this.latestDiagnostics.activeDeviceIndex = this.gamepadIndex;
      this.latestDiagnostics.profileName = this.activeProfile.name;
      this.latestDiagnostics.deviceName = this.activeProfile.name;
      this.failsafeActive = false;
      if (changed) {
        this.emitDeviceEvent('connected', preferred.id);
      }
    } else if (this.gamepadIndex !== null) {
      this.gamepadIndex = null;
      this.latestDiagnostics.activeDeviceIndex = null;
    }
    return this.getConnectedDevices();
  }

  public getConnectedDevices(): ConnectedDeviceSummary[] {
    return this.readBrowserGamepads()
      .filter(gp => gp && gp.connected)
      .map(gp => ({
        index: gp.index,
        id: gp.id || `Controller #${gp.index}`,
        mapping: gp.mapping || 'raw-hid',
        axesCount: gp.axes?.length ?? 0,
        buttonsCount: gp.buttons?.length ?? 0,
        connected: gp.connected,
        type: classifyHardwareDevice(gp.id || '', gp.mapping || ''),
      }));
  }

  private readBrowserGamepads(): Gamepad[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    const list = navigator.getGamepads();
    if (!list) return [];
    const out: Gamepad[] = [];
    for (let i = 0; i < list.length; i++) {
      const gp = list[i];
      if (gp) out.push(gp);
    }
    return out;
  }

  private getActiveBrowserGamepad(): Gamepad | null {
    const pads = this.readBrowserGamepads().filter(p => p && p.connected);
    if (pads.length === 0) return null;

    // Auto-switch if another USB device (not manually removed) shows clear stick/button activity while current is null or idle
    if (this.gamepadIndex !== null && !this.suppressedIndices.has(this.gamepadIndex)) {
      const cur = pads.find(p => p.index === this.gamepadIndex);
      if (cur) {
        for (const candidate of pads) {
          if (candidate.index === cur.index || this.suppressedIndices.has(candidate.index)) continue;
          const prev = this.lastScannedAxesByIndex.get(candidate.index);
          const curAxes = Array.from(candidate.axes || []).map(Number);
          const moved = curAxes.some((v, idx) => prev ? Math.abs(v - (prev[idx] ?? 0)) > 0.20 : Math.abs(v) > 0.35);
          const pressed = Array.from(candidate.buttons || []).some((b: any) => Boolean(b?.pressed));
          this.lastScannedAxesByIndex.set(candidate.index, curAxes);
          if (moved || pressed) {
            this.gamepadIndex = candidate.index;
            this.detectAndConfigureDevice(candidate);
            this.failsafeActive = false;
            this.emitDeviceEvent('switched', candidate.id);
            return candidate;
          }
        }
        return cur;
      }
    }

    // Current index missing or disconnected -> look for any active connected pad not suppressed
    const fallback = pads.find(p => !this.suppressedIndices.has(p.index));
    if (fallback) {
      this.gamepadIndex = fallback.index;
      this.detectAndConfigureDevice(fallback);
      this.failsafeActive = false;
      this.emitDeviceEvent('connected', fallback.id);
      return fallback;
    }

    return null;
  }

  public setDeviceProfile(profile: Partial<DeviceProfile>) {
    Object.assign(this.activeProfile, profile);
    this.syncConfigFromActiveProfile();
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

  private mergeSavedProfile(base: DeviceProfile, saved: Partial<DeviceProfile>) {
    Object.assign(base, saved);
    if (!base.axisCalibrations) base.axisCalibrations = defaultCalibrations();
    else {
      base.axisCalibrations = { ...defaultCalibrations(), ...base.axisCalibrations };
    }
    base.bindings = { ...createDefaultBindings(), ...(saved.bindings || {}) };
    if (base.enableTriggerDrive === undefined) {
      base.enableTriggerDrive = base.type === 'gamepad';
    }
  }

  private detectAndConfigureDevice(gp: Gamepad): DeviceProfile {
    const id = gp.id || 'Generic Gamepad';
    const mapping = gp.mapping || '';
    const type = classifyHardwareDevice(id, mapping);
    const axesLen = gp.axes?.length ?? 4;

    const builtin =
      type === 'transmitter_radiomaster'
        ? PREDEFINED_PROFILES[1]
        : type === 'transmitter_flysky'
          ? PREDEFINED_PROFILES[2]
          : type === 'transmitter_jumper'
            ? PREDEFINED_PROFILES[3]
            : PREDEFINED_PROFILES[0];

    const baseProfile = cloneProfile(builtin);
    baseProfile.id = id.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 36) || builtin.id;
    baseProfile.name = id;
    baseProfile.type = type;
    if (type === 'generic') {
      baseProfile.enableTriggerDrive = false;
      baseProfile.deadzone = 0.06;
      baseProfile.rightTrackAxis = axesLen > 3 ? 3 : axesLen > 2 ? 2 : 1;
    } else if (type === 'gamepad' && axesLen <= 3) {
      baseProfile.rightTrackAxis = axesLen > 2 ? 2 : 1;
    }

    const saved = this.loadSavedProfile(baseProfile.id);
    if (saved) {
      this.mergeSavedProfile(baseProfile, saved);
    }

    this.activeProfile = baseProfile;
    this.syncConfigFromActiveProfile();
    return baseProfile;
  }

  private setupListeners() {
    if (typeof window === 'undefined') return;

    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.suppressedIndices.delete(e.gamepad.index);
      this.gamepadIndex = e.gamepad.index;
      this.detectAndConfigureDevice(e.gamepad);
      this.latestDiagnostics.activeDeviceIndex = this.gamepadIndex;
      this.latestDiagnostics.deviceName = this.activeProfile.name;
      this.latestDiagnostics.profileName = this.activeProfile.name;
      this.failsafeActive = false;
      this.resetPrevActions();
      this.emitDeviceEvent('connected', e.gamepad.id);
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      this.suppressedIndices.delete(e.gamepad.index);
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.cancelAutoBind();
        this.resetPrevActions();
        this.neutralize();
        // Auto-switch to remaining USB device if another controller is still connected
        const remaining = this.readBrowserGamepads().find(p => p.index !== e.gamepad.index && p.connected);
        if (remaining) {
          this.gamepadIndex = remaining.index;
          this.detectAndConfigureDevice(remaining);
          this.latestDiagnostics.activeDeviceIndex = this.gamepadIndex;
          this.latestDiagnostics.deviceName = this.activeProfile.name;
          this.latestDiagnostics.profileName = this.activeProfile.name;
          this.failsafeActive = false;
          this.emitDeviceEvent('switched', remaining.id);
        } else {
          this.latestDiagnostics.activeDeviceIndex = null;
          this.latestDiagnostics.source = 'neutral';
          this.latestDiagnostics.deviceName = 'None';
          this.failsafeActive = true;
          this.emitDeviceEvent('disconnected', e.gamepad.id);
        }
      }
    });

    window.addEventListener('blur', () => this.neutralize());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.neutralize();
      });
    }
  }

  private resetPrevActions() {
    this.prevActionStates = {
      brake: false,
      recover: false,
      changeCamera: false,
      togglePause: false,
      skipGate: false,
      techTimeout: false,
    };
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
    const safeDz = Math.max(0, Math.min(0.45, deadzone));
    const safeExpo = Math.max(0, Math.min(0.9, expo));
    const mag = Math.abs(val);
    if (mag < safeDz) return 0;
    const scaled = Math.min(1, (mag - safeDz) / (1 - safeDz));
    const shaped = safeExpo * Math.pow(scaled, 3) + (1 - safeExpo) * scaled;
    return Math.sign(val) * shaped;
  }

  private evaluateTriggerBinding(
    binding: InputTriggerBinding | undefined,
    rawButtons: boolean[],
    rawAxes: number[]
  ): boolean {
    if (!binding || binding.kind === 'none') return false;
    if (binding.kind === 'button') {
      return Boolean(rawButtons[binding.index]);
    }
    const axVal = rawAxes[binding.index] ?? 0;
    return binding.direction === 'high' ? axVal >= binding.threshold : axVal <= binding.threshold;
  }

  public sample(gamepad: any, _timestampMs?: number): ControllerOutputs {
    if (gamepad) {
      if (typeof gamepad.index === 'number') {
        this.suppressedIndices.delete(gamepad.index);
        this.gamepadIndex = gamepad.index;
      }
      this.detectAndConfigureDevice(gamepad);
      this.failsafeActive = false;
    }
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
      skipGate: false,
      techTimeout: false,
      failsafeActive: this.failsafeActive,
    };

    // Detect USB connection state cleanly regardless of keyboard activity
    const prevGpConnected = this.gamepadIndex !== null;
    const gp = gamepadOverride || this.getActiveBrowserGamepad();
    const gpIsConnected = Boolean(gp && ('connected' in gp ? gp.connected : true));
    if (prevGpConnected && !gpIsConnected && !gamepadOverride && !this.suppressedIndices.has(this.gamepadIndex!)) {
      this.gamepadIndex = null;
      this.failsafeActive = true;
      outputs.failsafeActive = true;
      this.cancelAutoBind();
      this.resetPrevActions();
      this.emitDeviceEvent('disconnected', this.activeProfile.name);
    }

    const rawAxes: number[] = gpIsConnected && gp?.axes ? Array.from(gp.axes).map(Number) : [];
    const rawButtonObjs = gpIsConnected && gp?.buttons ? Array.from(gp.buttons) : [];
    const rawButtons: boolean[] = rawButtonObjs.map((b: any) => Boolean(b?.pressed));
    const rawButtonValues: number[] = rawButtonObjs.map((b: any) =>
      Number.isFinite(b?.value) ? Number(b.value) : (b?.pressed ? 1 : 0)
    );
    const calibratedAxes = rawAxes.map((v, idx) =>
      normalizeCalibratedAxis(v, this.activeProfile.axisCalibrations[idx])
    );

    if (gpIsConnected) {
      this.processInteractiveCaptures(rawAxes, rawButtons);
    }

    // 1. Keyboard Priority (W/S/A/T/D/B/Arrows/Space always override controller cleanly when pressed)
    const activeKeySet = this.keyboardCodes;
    const hasKeyboardDrive = ['KeyW', 'KeyS', 'KeyA', 'KeyT', 'KeyD', 'KeyB', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => activeKeySet.has(k));
    const isBrakingKey = activeKeySet.has('Space');

    if (hasKeyboardDrive || isBrakingKey) {
      outputs.source = 'keyboard';
      outputs.deviceName = 'Keyboard (W/S/A/D)';
      const keys = keyboardKeysFromCodes(activeKeySet);
      const { throttle, steering } = resolveKeyboardAxes(keys);
      const cmds = keyboardTrackCommands(keys, this.tuning, this.config.sensitivity);

      outputs.leftTrack = isBrakingKey ? 0 : cmds.left;
      outputs.rightTrack = isBrakingKey ? 0 : cmds.right;
      outputs.throttle = throttle;
      outputs.steering = steering; // +1 LEFT, -1 RIGHT
      outputs.brake = isBrakingKey;

      this.updateDiagnostics(outputs, rawAxes, calibratedAxes, rawButtons, rawButtonValues, throttle, steering);
      return outputs;
    }

    // 2. Gamepad / USB RC Transmitter (RadioMaster Boxer/TX16S, FlySky FS-i6X, Jumper, Xbox/PS, Generic HID)
    if (gpIsConnected) {
      const profile = this.activeProfile;
      const isTransmitter = profile.type.startsWith('transmitter');

      // Evaluate mapped digital actions & switches even when sticks sit centered!
      const bnd = profile.bindings || createDefaultBindings();
      const btnBrake = this.evaluateTriggerBinding(bnd.brake, rawButtons, rawAxes);
      const btnRecover = this.evaluateTriggerBinding(bnd.recover, rawButtons, rawAxes);
      const btnCamera = this.evaluateTriggerBinding(bnd.changeCamera, rawButtons, rawAxes);
      const btnPause = this.evaluateTriggerBinding(bnd.togglePause, rawButtons, rawAxes);
      const btnSkip = this.evaluateTriggerBinding(bnd.skipGate, rawButtons, rawAxes);
      const btnPit = this.evaluateTriggerBinding(bnd.techTimeout, rawButtons, rawAxes);

      outputs.brake = btnBrake;
      outputs.recover = btnRecover && !this.prevActionStates.recover;
      outputs.changeCamera = btnCamera && !this.prevActionStates.changeCamera;
      outputs.togglePause = btnPause && !this.prevActionStates.togglePause;
      outputs.skipGate = btnSkip && !this.prevActionStates.skipGate;
      outputs.techTimeout = btnPit && !this.prevActionStates.techTimeout;

      this.prevActionStates.brake = btnBrake;
      this.prevActionStates.recover = btnRecover;
      this.prevActionStates.changeCamera = btnCamera;
      this.prevActionStates.togglePause = btnPause;
      this.prevActionStates.skipGate = btnSkip;
      this.prevActionStates.techTimeout = btnPit;

      let left = 0;
      let right = 0;
      let semanticThrottle = 0;
      let semanticSteering = 0;

      if (this.config.mode === 'tank_dual_stick') {
        // Independent left & right track channels normalized from their individual [min, center, max] calibrations
        let rawLeftY = -(calibratedAxes[profile.leftTrackAxis] ?? 0);
        let rawRightY = -(calibratedAxes[profile.rightTrackAxis] ?? 0);
        if (profile.centerOffsetThrottle) {
          rawLeftY -= profile.centerOffsetThrottle;
          rawRightY -= profile.centerOffsetThrottle;
        }
        if (Boolean(this.config.invertThrottle || profile.invertThrottle) !== Boolean(profile.invertLeftTrack)) {
          rawLeftY = -rawLeftY;
        }
        if (Boolean(this.config.invertThrottle || profile.invertThrottle) !== Boolean(profile.invertRightTrack)) {
          rawRightY = -rawRightY;
        }

        left = this.applyDeadzoneAndExpo(rawLeftY, profile.deadzone, profile.expo);
        right = this.applyDeadzoneAndExpo(rawRightY, profile.deadzone, profile.expo);

        const gain = profile.sensitivity ?? this.config.sensitivity;
        left = Math.max(-1, Math.min(1, left * gain));
        right = Math.max(-1, Math.min(1, right * gain));

        semanticThrottle = (left + right) * 0.5;
        semanticSteering = (right - left) * 0.5;
      } else {
        // Single-stick / split-stick mode:
        let rawThrottle = -(calibratedAxes[profile.throttleAxis] ?? 0);
        if (profile.centerOffsetThrottle) rawThrottle -= profile.centerOffsetThrottle;
        if (this.config.invertThrottle || profile.invertThrottle) rawThrottle = -rawThrottle;
        semanticThrottle = this.applyDeadzoneAndExpo(rawThrottle, profile.deadzone, profile.expo);

        // Racing trigger drive (Xbox RT buttons[7] / LT buttons[6]) when stick throttle is near idle
        if (profile.enableTriggerDrive && rawButtonValues.length > 7 && Math.abs(semanticThrottle) < 0.08) {
          const trigForward = Math.max(0, Math.min(1, rawButtonValues[7] ?? 0));
          const trigReverse = Math.max(0, Math.min(1, rawButtonValues[6] ?? 0));
          const trigDiff = trigForward - trigReverse;
          if (Math.abs(trigDiff) > profile.deadzone) {
            semanticThrottle = this.applyDeadzoneAndExpo(trigDiff, profile.deadzone, profile.expo);
          }
        }

        let rawSteering = -(calibratedAxes[profile.steeringAxis] ?? 0);
        if (profile.centerOffsetSteering) rawSteering -= profile.centerOffsetSteering;
        if (this.config.invertSteering || profile.invertSteering) rawSteering = -rawSteering;
        semanticSteering = this.applyDeadzoneAndExpo(rawSteering, profile.deadzone, profile.expo);

        const isReverse = semanticThrottle < -0.05;
        const effectiveSteering = isReverse ? -semanticSteering : semanticSteering;
        const isPivot = Math.abs(semanticThrottle) < 0.05 && Math.abs(semanticSteering) > 0.05;
        const steerMix = (isPivot ? this.tuning.pivotSensitivity : this.tuning.steeringSensitivity) * (profile.sensitivity ?? this.config.sensitivity);
        const mixed = mixThrottleSteering(semanticThrottle, effectiveSteering, steerMix);

        left = mixed.left;
        right = mixed.right;
      }

      const touchOrMouseTakingOver =
        (this.touchLeft.active || this.touchRight.active || this.mouseActive) &&
        Math.abs(left) <= 0.01 &&
        Math.abs(right) <= 0.01 &&
        !btnBrake &&
        !outputs.recover &&
        !outputs.changeCamera &&
        !outputs.togglePause &&
        !outputs.skipGate &&
        !outputs.techTimeout;

      if (!touchOrMouseTakingOver) {
        outputs.source = isTransmitter ? 'transmitter' : 'gamepad';
        outputs.deviceName = profile.name;
        outputs.leftTrack = btnBrake ? 0 : Math.max(-1, Math.min(1, left));
        outputs.rightTrack = btnBrake ? 0 : Math.max(-1, Math.min(1, right));
        outputs.throttle = semanticThrottle;
        outputs.steering = semanticSteering;
        outputs.failsafeActive = false;

        this.updateDiagnostics(outputs, rawAxes, calibratedAxes, rawButtons, rawButtonValues, semanticThrottle, semanticSteering);
        return outputs;
      }
    }

    // 3. Virtual Touch Joysticks (Mobile / Tablet)
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
        const rawSteer = this.touchRight.active ? -this.touchRight.x : -this.touchLeft.x;

        const thr = this.applyDeadzoneAndExpo(rawThr);
        const steer = this.applyDeadzoneAndExpo(rawSteer);

        const isReverse = thr < -0.05;
        const effectiveSteer = isReverse ? -steer : steer;
        const mixed = mixThrottleSteering(thr, effectiveSteer, this.tuning.steeringSensitivity * this.config.sensitivity);
        outputs.leftTrack = mixed.left;
        outputs.rightTrack = mixed.right;
        outputs.throttle = thr;
        outputs.steering = steer;
      }

      this.updateDiagnostics(outputs, rawAxes, calibratedAxes, rawButtons, rawButtonValues, outputs.throttle, outputs.steering);
      return outputs;
    }

    // 4. Mouse Drag Virtual Joystick
    if (this.mouseActive) {
      outputs.source = 'mouse';
      outputs.deviceName = 'Mouse Virtual Track';
      outputs.leftTrack = Math.max(-1, Math.min(1, this.mouseLeft));
      outputs.rightTrack = Math.max(-1, Math.min(1, this.mouseRight));
      outputs.throttle = (outputs.leftTrack + outputs.rightTrack) * 0.5;
      outputs.steering = (outputs.rightTrack - outputs.leftTrack) * 0.5;
      this.updateDiagnostics(outputs, rawAxes, calibratedAxes, rawButtons, rawButtonValues, outputs.throttle, outputs.steering);
      return outputs;
    }

    this.updateDiagnostics(outputs, rawAxes, calibratedAxes, rawButtons, rawButtonValues, 0, 0);
    return outputs;
  }

  private updateDiagnostics(
    outputs: ControllerOutputs,
    rawAxes: number[],
    calibratedAxes: number[],
    rawButtons: boolean[],
    rawButtonValues: number[],
    throttle: number,
    steering: number
  ) {
    this.latestDiagnostics = {
      source: outputs.source,
      deviceName: outputs.deviceName,
      profileName: this.activeProfile.name,
      activeDeviceIndex: this.gamepadIndex,
      connectedDevices: this.getConnectedDevices(),
      rawAxes,
      calibratedAxes,
      rawButtons,
      rawButtonValues,
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
      calibrationWizard: {
        activeSweep: this.sweepActive,
        waitingAxisTarget: this.waitingAxisTarget,
        waitingBindingAction: this.waitingBindingAction,
      },
    };
  }
}
