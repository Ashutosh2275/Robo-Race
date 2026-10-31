import { keyboardKeysFromCodes, keyboardTrackCommands, pivotTrackCommands, type ControlTuning, type KeyboardKeys, type TrackCommands } from './driveControls';
import { mixDifferentialSteering } from './drivePhysics';

export type ControllerMode = 'single_stick' | 'tank_dual_stick';

export type ControllerConfig = {
  mode: ControllerMode;
  deadzone: number;     // 0.0 to 0.25
  expo: number;         // 0.0 to 0.6
  sensitivity: number;  // 0.4 to 1.6
  invertThrottle: boolean;
  invertSteering: boolean;
};

export type ControllerOutputs = {
  source: 'keyboard' | 'gamepad' | 'touch' | 'mouse' | 'neutral';
  deviceName: string;
  leftTrack: number;
  rightTrack: number;
  throttle: number;
  steering: number;
  brake: boolean;
  recover: boolean;
  changeCamera: boolean;
  togglePause: boolean;
};

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
  private buttonStates = { brake: false, recover: false, camera: false, pause: false };
  private prevButtonStates = { brake: false, recover: false, camera: false, pause: false };

  constructor(config: ControllerConfig, tuning: ControlTuning) {
    this.config = config;
    this.tuning = tuning;
    this.setupListeners();
  }

  public updateConfig(newConfig: Partial<ControllerConfig>) {
    Object.assign(this.config, newConfig);
  }

  public updateTuning(newTuning: Partial<ControlTuning>) {
    Object.assign(this.tuning, newTuning);
  }

  private setupListeners() {
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
      this.gamepadIndex = e.gamepad.index;
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
      if (this.gamepadIndex === e.gamepad.index) {
        this.gamepadIndex = null;
        this.neutralize();
      }
    });

    window.addEventListener('blur', () => this.neutralize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.neutralize();
    });
  }

  public handleKeyDown(code: string) {
    this.keyboardCodes.add(code);
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
  }

  public setMouseTrack(left: number, right: number, active: boolean) {
    this.mouseLeft = left;
    this.mouseRight = right;
    this.mouseActive = active;
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

  private applyDeadzoneAndExpo(val: number): number {
    const dead = this.config.deadzone;
    const mag = Math.abs(val);
    if (mag < dead) return 0;
    const scaled = (mag - dead) / (1 - dead);
    const expo = this.config.expo;
    // Standard RC expo curve: expo * x^3 + (1 - expo) * x
    const shaped = expo * Math.pow(scaled, 3) + (1 - expo) * scaled;
    return Math.sign(val) * shaped;
  }

  public poll(): ControllerOutputs {
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
    };

    // 1. Check Keyboard Priority
    const activeKeySet = this.keyboardCodes;
    const hasKeyboardDrive = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyB', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => activeKeySet.has(k));
    const isBrakingKey = activeKeySet.has('Space');

    if (hasKeyboardDrive || isBrakingKey) {
      outputs.source = 'keyboard';
      outputs.deviceName = 'Keyboard';
      const keys = keyboardKeysFromCodes(activeKeySet);
      const cmds = keyboardTrackCommands(keys, {
        forwardSensitivity: this.tuning.forwardSensitivity * this.config.sensitivity,
        reverseSensitivity: this.tuning.reverseSensitivity * this.config.sensitivity,
        steeringSensitivity: this.tuning.steeringSensitivity * this.config.sensitivity,
        pivotSensitivity: this.tuning.pivotSensitivity * this.config.sensitivity,
      });

      outputs.leftTrack = isBrakingKey ? 0 : cmds.left;
      outputs.rightTrack = isBrakingKey ? 0 : cmds.right;
      outputs.throttle = (cmds.left + cmds.right) * 0.5;
      outputs.steering = (cmds.right - cmds.left) * 0.5;
      outputs.brake = isBrakingKey;
      return outputs;
    }

    // 2. Check Gamepad (Xbox, PlayStation, Generic USB, RadioMaster / EdgeTX)
    if (this.gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this.gamepadIndex];
      if (gp && gp.connected) {
        outputs.deviceName = gp.id || 'Gamepad / Transmitter';

        // Read axes
        // In standard Gamepad mapping:
        // Axis 0 = Left stick X, Axis 1 = Left stick Y (up is -1)
        // Axis 2 = Right stick X, Axis 3 = Right stick Y (up is -1)
        const axis0 = gp.axes[0] ?? 0;
        const axis1 = -(gp.axes[1] ?? 0); // Invert so up is +1 (forward)
        const axis2 = gp.axes[2] ?? 0;
        const axis3 = -(gp.axes[3] ?? 0);

        // Buttons
        const btnA = gp.buttons[0]?.pressed ?? false;      // Brake / Action
        const btnB = gp.buttons[1]?.pressed ?? false;      // Recover
        const btnX = gp.buttons[2]?.pressed ?? false;      // Camera
        const btnStart = gp.buttons[9]?.pressed ?? false;  // Pause

        outputs.brake = btnA;
        outputs.recover = btnB && !this.prevButtonStates.recover;
        outputs.changeCamera = btnX && !this.prevButtonStates.camera;
        outputs.togglePause = btnStart && !this.prevButtonStates.pause;

        this.prevButtonStates.recover = btnB;
        this.prevButtonStates.camera = btnX;
        this.prevButtonStates.pause = btnStart;

        let left = 0;
        let right = 0;

        if (this.config.mode === 'tank_dual_stick') {
          // Left stick controls left track, right stick controls right track
          left = this.applyDeadzoneAndExpo(axis1);
          right = this.applyDeadzoneAndExpo(axis3);
        } else {
          // Single-stick mode: Axis 1 = throttle, Axis 0 (or Axis 2) = steering
          let thr = this.applyDeadzoneAndExpo(axis1);
          let steer = this.applyDeadzoneAndExpo(Math.abs(axis2) > Math.abs(axis0) ? axis2 : axis0);

          if (this.config.invertThrottle) thr = -thr;
          if (this.config.invertSteering) steer = -steer;

          // steer > 0 is turn right, steer < 0 is turn left
          const mixed = mixDifferentialSteering(thr, thr, steer);
          left = mixed.left;
          right = mixed.right;
        }

        left *= this.config.sensitivity;
        right *= this.config.sensitivity;

        if (Math.abs(left) > 0.01 || Math.abs(right) > 0.01 || btnA) {
          outputs.source = 'gamepad';
          outputs.leftTrack = btnA ? 0 : Math.max(-1, Math.min(1, left));
          outputs.rightTrack = btnA ? 0 : Math.max(-1, Math.min(1, right));
          outputs.throttle = (left + right) * 0.5;
          outputs.steering = (right - left) * 0.5;
          return outputs;
        }
      }
    }

    // 3. Check Touch Screen Sticks
    if (this.touchLeft.active || this.touchRight.active) {
      outputs.source = 'touch';
      outputs.deviceName = 'Touch Screen';

      if (this.config.mode === 'tank_dual_stick') {
        const leftVal = this.applyDeadzoneAndExpo(this.touchLeft.y);
        const rightVal = this.applyDeadzoneAndExpo(this.touchRight.y);
        outputs.leftTrack = Math.max(-1, Math.min(1, leftVal * this.config.sensitivity));
        outputs.rightTrack = Math.max(-1, Math.min(1, rightVal * this.config.sensitivity));
      } else {
        const thr = this.applyDeadzoneAndExpo(this.touchLeft.y || this.touchRight.y);
        const steer = this.applyDeadzoneAndExpo(this.touchRight.x || this.touchLeft.x);
        const mixed = mixDifferentialSteering(thr, thr, steer);
        outputs.leftTrack = mixed.left * this.config.sensitivity;
        outputs.rightTrack = mixed.right * this.config.sensitivity;
      }

      outputs.throttle = (outputs.leftTrack + outputs.rightTrack) * 0.5;
      outputs.steering = (outputs.rightTrack - outputs.leftTrack) * 0.5;
      return outputs;
    }

    // 4. Check Mouse Drag
    if (this.mouseActive) {
      outputs.source = 'mouse';
      outputs.deviceName = 'Mouse Drag';
      outputs.leftTrack = Math.max(-1, Math.min(1, this.mouseLeft));
      outputs.rightTrack = Math.max(-1, Math.min(1, this.mouseRight));
      outputs.throttle = (outputs.leftTrack + outputs.rightTrack) * 0.5;
      outputs.steering = (outputs.rightTrack - outputs.leftTrack) * 0.5;
      return outputs;
    }

    return outputs;
  }
}
