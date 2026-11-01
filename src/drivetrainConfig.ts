/**
 * Game-side representation of the user's two-motor / two-belt robot.
 * The photographs show two large wheel ends per belt but do not reveal which
 * wheel is powered. The requested diagonal arrangement is therefore the
 * configurable default and remains explicitly marked as an assumption.
 */
export type WheelPosition = 'left-front' | 'left-rear' | 'right-front' | 'right-rear';
export type DriveWheelLayout = 'left-front-right-rear' | 'left-rear-right-front';

export interface MotorSpecification {
  side: 'left' | 'right';
  ratedRpm: number;
  poweredWheel: WheelPosition;
  gearboxRatio: number;
  efficiency: number;
  ratedTorqueNm: number;
  sprocketRadiusM: number;
}

export const DEFAULT_DRIVE_WHEEL_LAYOUT: DriveWheelLayout = 'left-front-right-rear';
export const DRIVE_SPROCKET_RADIUS_M = 0.18;

// 600 RPM is specified by the user. Gear reduction and effective sprocket
// radius are tuning placeholders, not measurements of the real robot.
export const MOTOR_SPECIFICATIONS: readonly MotorSpecification[] = [
  { side: 'left', ratedRpm: 600, poweredWheel: 'left-front', gearboxRatio: 1.8, efficiency: 0.85, ratedTorqueNm: 2.0, sprocketRadiusM: DRIVE_SPROCKET_RADIUS_M },
  { side: 'right', ratedRpm: 600, poweredWheel: 'right-rear', gearboxRatio: 1.8, efficiency: 0.85, ratedTorqueNm: 2.0, sprocketRadiusM: DRIVE_SPROCKET_RADIUS_M },
];

// Robot mass is not measurable from the supplied photographs. These defaults
// are only a tunable game-simulation assumption, not a claim about the hardware.
export const SIMULATED_ROBOT_MASS_KG = 2.0;

export const PRIMARY_WHEELS: readonly WheelPosition[] = [
  'left-front', 'left-rear', 'right-front', 'right-rear',
];

export function configureDriveWheelLayout(layout: DriveWheelLayout): readonly MotorSpecification[] {
  return MOTOR_SPECIFICATIONS.map((motor) => ({
    ...motor,
    poweredWheel: motor.side === 'left'
      ? (layout === 'left-front-right-rear' ? 'left-front' : 'left-rear')
      : (layout === 'left-front-right-rear' ? 'right-rear' : 'right-front'),
  }));
}

export function maxTrackSpeedMps(motor: MotorSpecification): number {
  const wheelRpm = motor.ratedRpm / motor.gearboxRatio;
  const circumferenceM = 2 * Math.PI * motor.sprocketRadiusM;
  return circumferenceM * wheelRpm / 60 * motor.efficiency;
}

export function maxMotorAccelerationMps2(motor: MotorSpecification, massKg = SIMULATED_ROBOT_MASS_KG): number {
  const wheelTorqueNm = motor.ratedTorqueNm * motor.gearboxRatio * motor.efficiency;
  const trackForceN = wheelTorqueNm / motor.sprocketRadiusM;
  return trackForceN / Math.max(0.1, massKg);
}

export function drivetrainTopology(layout = DEFAULT_DRIVE_WHEEL_LAYOUT) {
  const motors = configureDriveWheelLayout(layout);
  return {
    wheels: [...PRIMARY_WHEELS],
    motors,
    poweredWheels: motors.map((m) => m.poweredWheel),
    passiveWheels: PRIMARY_WHEELS.filter((wheel) => !motors.some((m) => m.poweredWheel === wheel)),
    beltCount: 2,
  } as const;
}
