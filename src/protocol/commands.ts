import {
  BUTTONS,
  COLORS,
  SERVOS,
  SIDES,
  type ArgValue,
  type Args,
  type Capability,
  type ColorName,
} from './types';

/**
 * Catálogo único de comandos del protocolo: nombre, capacidad requerida y
 * rango válido de cada parámetro. Lo usan el validador de la app, el motor de
 * ejecución y el simulador, de modo que no hay reglas duplicadas.
 */

export type ArgSpec =
  | { readonly kind: 'int'; readonly min: number; readonly max: number }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'bool' }
  | { readonly kind: 'text'; readonly maxLength: number };

export interface CommandSpec {
  /** Capacidad que debe estar disponible; null = comando de sistema. */
  readonly capability: Capability | null;
  readonly args: Readonly<Record<string, ArgSpec>>;
  /** Duración esperada (ms) para calcular el tiempo máximo de espera de "done". */
  readonly expectedDurationMs: (args: Args) => number;
}

export const MAX_DURATION_MS = 30_000;

const int = (min: number, max: number): ArgSpec => ({ kind: 'int', min, max });
const oneOf = (values: readonly string[]): ArgSpec => ({ kind: 'enum', values });
const instant = (): number => 0;
const durationArg = (args: Args): number =>
  typeof args['duration_ms'] === 'number' ? args['duration_ms'] : 0;

const motion: CommandSpec = {
  capability: 'motion',
  args: { speed: int(0, 100), duration_ms: int(0, MAX_DURATION_MS) },
  expectedDurationMs: durationArg,
};

export const COMMANDS = {
  // Sistema
  HELLO: { capability: null, args: { app_protocol: { kind: 'text', maxLength: 16 } }, expectedDurationMs: instant },
  PING: { capability: null, args: {}, expectedDurationMs: instant },
  GET_MODULES: { capability: null, args: {}, expectedDurationMs: () => 500 },
  STOP: { capability: null, args: {}, expectedDurationMs: instant },

  // Movimiento (Módulo 1)
  MOVE_FORWARD: motion,
  MOVE_BACKWARD: motion,
  TURN_LEFT: motion,
  TURN_RIGHT: motion,
  STOP_MOTORS: { capability: 'motion', args: {}, expectedDurationMs: instant },

  // Brazos (Módulo 1)
  SET_SERVO: {
    capability: 'arms',
    args: { servo: oneOf(SERVOS), angle: int(0, 180) },
    expectedDurationMs: () => 600,
  },
  GRIPPER: {
    capability: 'arms',
    args: { side: oneOf(SIDES), action: oneOf(['open', 'close']) },
    expectedDurationMs: () => 600,
  },

  // Sensores
  READ_COLOR: { capability: 'color_sensor', args: {}, expectedDurationMs: () => 200 },
  READ_DISTANCE: { capability: 'distance', args: {}, expectedDurationMs: () => 200 },

  // Luces y sonido (Módulo 2). led: 1‑4, 0 = todos.
  SET_LED: { capability: 'leds', args: { led: int(0, 4), on: { kind: 'bool' } }, expectedDurationMs: instant },
  TOGGLE_LED: { capability: 'leds', args: { led: int(0, 4) }, expectedDurationMs: instant },
  BEEP: { capability: 'buzzer', args: { duration_ms: int(10, 5000) }, expectedDurationMs: durationArg },
  PLAY_TONE: {
    capability: 'buzzer',
    args: { freq_hz: int(100, 5000), duration_ms: int(10, 5000) },
    expectedDurationMs: durationArg,
  },

  // Pantalla y botones (Módulo 3)
  DISPLAY_TEXT: { capability: 'display', args: { text: { kind: 'text', maxLength: 32 } }, expectedDurationMs: instant },
  DISPLAY_CLEAR: { capability: 'display', args: {}, expectedDurationMs: instant },
  READ_BUTTON: { capability: 'buttons', args: { button: oneOf(BUTTONS) }, expectedDurationMs: () => 100 },
} as const satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(COMMANDS, value);
}

export interface ArgError {
  readonly arg: string;
  readonly reason: string;
}

function checkArg(name: string, spec: ArgSpec, value: ArgValue | undefined): ArgError | null {
  if (value === undefined) return { arg: name, reason: 'falta el valor' };
  switch (spec.kind) {
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return { arg: name, reason: 'debe ser un número entero' };
      if (value < spec.min || value > spec.max) return { arg: name, reason: `debe estar entre ${spec.min} y ${spec.max}` };
      return null;
    case 'enum':
      if (typeof value !== 'string' || !spec.values.includes(value)) return { arg: name, reason: 'opción no válida' };
      return null;
    case 'bool':
      return typeof value === 'boolean' ? null : { arg: name, reason: 'debe ser verdadero o falso' };
    case 'text':
      if (typeof value !== 'string') return { arg: name, reason: 'debe ser texto' };
      if (value.length > spec.maxLength) return { arg: name, reason: `máximo ${spec.maxLength} caracteres` };
      return null;
  }
}

/** Valida los parámetros de un comando. Devuelve la lista de errores (vacía si todo está bien). */
export function validateArgs(cmd: CommandName, args: Args): ArgError[] {
  const spec: CommandSpec = COMMANDS[cmd];
  const errors: ArgError[] = [];
  for (const [name, argSpec] of Object.entries(spec.args)) {
    const err = checkArg(name, argSpec, args[name]);
    if (err) errors.push(err);
  }
  for (const name of Object.keys(args)) {
    if (!Object.hasOwn(spec.args, name)) errors.push({ arg: name, reason: 'parámetro desconocido' });
  }
  return errors;
}

/** Formato legible de una instrucción, p. ej. MOVE_FORWARD(speed=50, duration_ms=2000). */
export function formatInstruction(cmd: string, args: Args): string {
  const params = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
  return `${cmd}(${params})`;
}

// ─── Validación de resultados de lectura ────────────────────────────────────

export function parseColorResult(result: Readonly<Record<string, unknown>>): ColorName | null {
  const color = result['color'];
  return typeof color === 'string' && (COLORS as readonly string[]).includes(color) ? (color as ColorName) : null;
}

export function parseDistanceResult(result: Readonly<Record<string, unknown>>): number | null {
  const cm = result['cm'];
  return typeof cm === 'number' && Number.isFinite(cm) && cm >= 0 && cm <= 1000 ? cm : null;
}

export function parseButtonResult(result: Readonly<Record<string, unknown>>): boolean | null {
  const pressed = result['pressed'];
  return typeof pressed === 'boolean' ? pressed : null;
}

