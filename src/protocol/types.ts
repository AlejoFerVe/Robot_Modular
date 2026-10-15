/**
 * Tipos del protocolo de aplicación App ⇄ ESP32 principal (Módulo 1).
 * Especificación completa: docs/PROTOCOLO.md
 *
 * Este protocolo viaja sobre la capa de transporte (USB serie hoy, Wi‑Fi en el
 * futuro). NO es el protocolo I²C entre el Módulo 1 y los módulos secundarios.
 */

/** Versión del protocolo que implementa esta aplicación. */
export const PROTOCOL_VERSION = { major: 1, minor: 0 } as const;

export type ModuleType = 'base' | 'sensors' | 'interface';

export const MODULE_TYPES: readonly ModuleType[] = ['base', 'sensors', 'interface'];

/** Identificador numérico de tipo que cada módulo expone en su registro I²C. */
export const MODULE_TYPE_IDS: Readonly<Record<ModuleType, number>> = {
  base: 0x01,
  sensors: 0x02,
  interface: 0x03,
};

export type Capability =
  | 'motion'
  | 'arms'
  | 'color_sensor'
  | 'distance'
  | 'leds'
  | 'buzzer'
  | 'display'
  | 'buttons';

export const CAPABILITIES: readonly Capability[] = [
  'motion',
  'arms',
  'color_sensor',
  'distance',
  'leds',
  'buzzer',
  'display',
  'buttons',
];

/** Estado operativo informado por el firmware para cada módulo. */
export type ModuleOperationalState = 'ok' | 'error' | 'absent';

export interface ModuleReport {
  readonly type: ModuleType;
  readonly typeId: number;
  /** Versión del firmware del módulo (semver, p. ej. "0.1.0"). Vacío si está ausente. */
  readonly firmware: string;
  /** Capacidades implementadas y operativas. Vacío si está ausente o en error. */
  readonly capabilities: readonly Capability[];
  readonly state: ModuleOperationalState;
  /** Código de error del módulo cuando state === 'error'. */
  readonly error?: string;
}

export const COLORS = ['red', 'green', 'blue', 'yellow', 'black', 'white', 'unknown'] as const;
export type ColorName = (typeof COLORS)[number];

export const SERVOS = ['shoulder_left', 'shoulder_right', 'gripper_left', 'gripper_right'] as const;
export type ServoName = (typeof SERVOS)[number];

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

export const BUTTONS = ['A', 'B'] as const;
export type ButtonName = (typeof BUTTONS)[number];

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNKNOWN_COMMAND'
  | 'INVALID_ARGS'
  | 'MODULE_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'BUSY'
  | 'ABORTED'
  | 'HARDWARE_ERROR'
  | 'I2C_ERROR'
  | 'VERSION_MISMATCH';

export const ERROR_CODES: readonly ErrorCode[] = [
  'BAD_REQUEST',
  'UNKNOWN_COMMAND',
  'INVALID_ARGS',
  'MODULE_UNAVAILABLE',
  'NOT_IMPLEMENTED',
  'BUSY',
  'ABORTED',
  'HARDWARE_ERROR',
  'I2C_ERROR',
  'VERSION_MISMATCH',
];

export type ArgValue = number | string | boolean;
export type Args = Readonly<Record<string, ArgValue>>;

/** App → Robot */
export interface RequestMessage {
  readonly v: number;
  readonly type: 'req';
  readonly id: number;
  readonly cmd: string;
  readonly args: Args;
}

/** Robot → App: comando aceptado, empieza a ejecutarse. */
export interface AckMessage {
  readonly v: number;
  readonly type: 'ack';
  readonly id: number;
}

/** Robot → App: comando terminado correctamente. */
export interface DoneMessage {
  readonly v: number;
  readonly type: 'done';
  readonly id: number;
  readonly result: Readonly<Record<string, unknown>>;
}

/** Robot → App: comando rechazado o fallido. */
export interface ErrorMessage {
  readonly v: number;
  readonly type: 'err';
  /** null si el error no puede asociarse a una petición (p. ej. JSON ilegible). */
  readonly id: number | null;
  readonly code: ErrorCode;
  readonly msg: string;
}

export interface ModulesEvent {
  readonly v: number;
  readonly type: 'evt';
  readonly evt: 'modules';
  readonly modules: readonly ModuleReport[];
}

export interface StatusEvent {
  readonly v: number;
  readonly type: 'evt';
  readonly evt: 'status';
  readonly busy: boolean;
  readonly uptime_ms: number;
}

export type EventMessage = ModulesEvent | StatusEvent;
export type RobotMessage = AckMessage | DoneMessage | ErrorMessage | EventMessage;

export interface HelloResult {
  readonly protocol: string;
  readonly robot: string;
  readonly firmware: string;
  readonly modules: readonly ModuleReport[];
}

/**
 * Módulo al que pertenece cada capacidad (diseño de referencia). La app NO usa
 * esto para decidir qué hay conectado: eso lo dicen siempre los informes del robot.
 * Se usa para redactar mensajes («necesita el Módulo 2») y en el simulador.
 */
export const MODULE_CAPABILITIES: Readonly<Record<ModuleType, readonly Capability[]>> = {
  base: ['motion', 'arms', 'color_sensor'],
  sensors: ['distance', 'leds', 'buzzer'],
  interface: ['display', 'buttons'],
};

export function capabilityOwner(cap: Capability): ModuleType {
  return MODULE_TYPES.find((m) => MODULE_CAPABILITIES[m].includes(cap)) ?? 'base';
}
