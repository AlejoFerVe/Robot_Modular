import type { Capability, ColorName } from '../protocol/types';

/**
 * Definiciones visuales de los bloques (formato JSON de Blockly).
 * La semántica de cada bloque está en compiler.ts; aquí solo se describe su
 * aspecto, sus campos y qué capacidades del robot necesita.
 */

export type CategoryId = 'control' | 'logic' | 'variables' | 'motion' | 'arms' | 'sensors' | 'lights' | 'display';

export interface CategoryDef {
  readonly id: CategoryId;
  readonly name: string;
  readonly colour: string;
}

export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'control', name: 'Control', colour: '#F5A623' },
  { id: 'motion', name: 'Movimiento', colour: '#4C8DF6' },
  { id: 'arms', name: 'Brazos', colour: '#8E6CEF' },
  { id: 'sensors', name: 'Sensores', colour: '#1FAFC4' },
  { id: 'lights', name: 'Luces y sonido', colour: '#E8833A' },
  { id: 'display', name: 'Pantalla y botones', colour: '#E0558B' },
  { id: 'logic', name: 'Comparaciones', colour: '#4CAF50' },
  { id: 'variables', name: 'Variables', colour: '#D65C5C' },
];

export const CATEGORY_COLOUR = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.colour])) as Record<CategoryId, string>;

/** Bloque tal como aparece en la caja de herramientas (con valores iniciales). */
export interface ToolboxEntry {
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface RobotBlockDef {
  readonly type: string;
  readonly category: CategoryId;
  /** Capacidades necesarias; el bloque solo aparece si todas están disponibles. */
  readonly requires: readonly Capability[];
  /** Definición JSON de Blockly, sin "type" ni "colour" (se añaden automáticamente). */
  readonly json: Readonly<Record<string, unknown>>;
  /** Variantes que se muestran en la caja de herramientas. Por defecto, una sin cambios. */
  readonly toolbox?: readonly ToolboxEntry[];
}

export const COLOR_LABELS: Readonly<Record<ColorName, string>> = {
  red: 'rojo',
  green: 'verde',
  blue: 'azul',
  yellow: 'amarillo',
  black: 'negro',
  white: 'blanco',
  unknown: 'desconocido',
};

export const NOTES: readonly (readonly [label: string, hz: number])[] = [
  ['Do', 262],
  ['Re', 294],
  ['Mi', 330],
  ['Fa', 349],
  ['Sol', 392],
  ['La', 440],
  ['Si', 494],
  ['Do agudo', 523],
];

const LED_OPTIONS = [
  ['LED 1', '1'],
  ['LED 2', '2'],
  ['LED 3', '3'],
  ['LED 4', '4'],
  ['todos los LED', '0'],
];

const SIDE_OPTIONS = [
  ['izquierda', 'left'],
  ['derecha', 'right'],
];

const COMPARE_OPTIONS = [
  ['<', '<'],
  ['≤', '<='],
  ['>', '>'],
  ['≥', '>='],
  ['=', '=='],
  ['≠', '!='],
];

/** Límites compartidos entre bloques y compilador. */
export const LIMITS = {
  seconds: { min: 0.1, max: 30 },
  waitSeconds: { min: 0.1, max: 60 },
  speed: { min: 10, max: 100 },
  angle: { min: 0, max: 180 },
  repeat: { min: 1, max: 100 },
  beepSeconds: { min: 0.1, max: 5 },
  text: { maxLength: 32 },
} as const;

const seconds = (name: string, value: number, lim: { min: number; max: number } = LIMITS.seconds) => ({
  type: 'field_number',
  name,
  value,
  min: lim.min,
  max: lim.max,
  precision: 0.1,
});

const angle = (value: number) => ({
  type: 'field_number',
  name: 'ANGLE',
  value,
  min: LIMITS.angle.min,
  max: LIMITS.angle.max,
  precision: 1,
});

const statement = { previousStatement: null, nextStatement: null } as const;
const numberShadow = (n: number) => ({ shadow: { type: 'robot_number', fields: { NUM: n } } });
const textShadow = (t: string) => ({ shadow: { type: 'robot_text', fields: { TEXT: t } } });

export const BLOCKS: readonly RobotBlockDef[] = [
  // ─── Control ──────────────────────────────────────────────────────────
  {
    type: 'robot_on_start',
    category: 'control',
    requires: [],
    json: {
      message0: '▶ Al iniciar',
      nextStatement: null,
      hat: 'cap',
      tooltip: 'Tu programa empieza aquí. Pon debajo los bloques que quieres que haga el robot.',
    },
  },
  {
    type: 'robot_wait',
    category: 'control',
    requires: [],
    json: {
      message0: 'esperar %1 segundos',
      args0: [seconds('SECONDS', 1, LIMITS.waitSeconds)],
      ...statement,
      tooltip: 'El programa espera antes de seguir.',
    },
  },
  {
    type: 'robot_repeat',
    category: 'control',
    requires: [],
    json: {
      message0: 'repetir %1 veces',
      args0: [{ type: 'field_number', name: 'TIMES', value: 3, min: LIMITS.repeat.min, max: LIMITS.repeat.max, precision: 1 }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      ...statement,
      tooltip: 'Repite los bloques de dentro el número de veces que elijas.',
    },
  },
  {
    type: 'robot_forever',
    category: 'control',
    requires: [],
    json: {
      message0: 'repetir siempre',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      previousStatement: null,
      tooltip: 'Repite los bloques de dentro hasta que pulses Detener.',
    },
  },
  {
    type: 'robot_if',
    category: 'control',
    requires: [],
    json: {
      message0: 'si %1 entonces',
      args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      ...statement,
      tooltip: 'Hace los bloques de dentro solo si la condición se cumple.',
    },
  },
  {
    type: 'robot_if_else',
    category: 'control',
    requires: [],
    json: {
      message0: 'si %1 entonces',
      args0: [{ type: 'input_value', name: 'COND', check: 'Boolean' }],
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      message2: 'si no',
      message3: '%1',
      args3: [{ type: 'input_statement', name: 'ELSE' }],
      ...statement,
      tooltip: 'Si la condición se cumple hace la primera parte; si no, la segunda.',
    },
  },

  // ─── Comparaciones y valores ──────────────────────────────────────────
  {
    type: 'robot_compare',
    category: 'logic',
    requires: [],
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A' },
        { type: 'field_dropdown', name: 'OP', options: COMPARE_OPTIONS },
        { type: 'input_value', name: 'B' },
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip: 'Compara dos valores.',
    },
    toolbox: [{ inputs: { A: numberShadow(0), B: numberShadow(10) } }],
  },
  {
    type: 'robot_logic',
    category: 'logic',
    requires: [],
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Boolean' },
        { type: 'field_dropdown', name: 'OP', options: [['y', 'and'], ['o', 'or']] },
        { type: 'input_value', name: 'B', check: 'Boolean' },
      ],
      inputsInline: true,
      output: 'Boolean',
      tooltip: '«y»: se cumplen las dos. «o»: se cumple al menos una.',
    },
  },
  {
    type: 'robot_not',
    category: 'logic',
    requires: [],
    json: {
      message0: 'no %1',
      args0: [{ type: 'input_value', name: 'A', check: 'Boolean' }],
      output: 'Boolean',
      tooltip: 'Lo contrario de la condición.',
    },
  },
  {
    type: 'robot_bool',
    category: 'logic',
    requires: [],
    json: {
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'BOOL', options: [['verdadero', 'true'], ['falso', 'false']] }],
      output: 'Boolean',
      tooltip: 'Verdadero o falso.',
    },
  },
  {
    type: 'robot_number',
    category: 'logic',
    requires: [],
    json: {
      message0: '%1',
      args0: [{ type: 'field_number', name: 'NUM', value: 0, min: -10000, max: 10000 }],
      output: 'Number',
      tooltip: 'Un número.',
    },
  },
  {
    type: 'robot_text',
    category: 'logic',
    requires: [],
    json: {
      message0: '“%1”',
      args0: [{ type: 'field_input', name: 'TEXT', text: 'Hola' }],
      output: 'String',
      tooltip: 'Un texto corto.',
    },
  },
  {
    type: 'robot_arith',
    category: 'logic',
    requires: [],
    json: {
      message0: '%1 %2 %3',
      args0: [
        { type: 'input_value', name: 'A', check: 'Number' },
        { type: 'field_dropdown', name: 'OP', options: [['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/']] },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      inputsInline: true,
      output: 'Number',
      tooltip: 'Suma, resta, multiplica o divide.',
    },
    toolbox: [{ inputs: { A: numberShadow(1), B: numberShadow(1) } }],
  },

  // ─── Variables ────────────────────────────────────────────────────────
  {
    type: 'robot_var_set',
    category: 'variables',
    requires: [],
    json: {
      message0: 'poner %1 a %2',
      args0: [
        { type: 'field_variable', name: 'VAR', variable: 'contador' },
        { type: 'input_value', name: 'VALUE' },
      ],
      ...statement,
      tooltip: 'Guarda un valor en una variable.',
    },
    toolbox: [{ inputs: { VALUE: numberShadow(0) } }],
  },
  {
    type: 'robot_var_change',
    category: 'variables',
    requires: [],
    json: {
      message0: 'sumar %2 a %1',
      args0: [
        { type: 'field_variable', name: 'VAR', variable: 'contador' },
        { type: 'input_value', name: 'DELTA', check: 'Number' },
      ],
      ...statement,
      tooltip: 'Suma un número a la variable (usa un número negativo para restar).',
    },
    toolbox: [{ inputs: { DELTA: numberShadow(1) } }],
  },
  {
    type: 'robot_var_get',
    category: 'variables',
    requires: [],
    json: {
      message0: '%1',
      args0: [{ type: 'field_variable', name: 'VAR', variable: 'contador' }],
      output: null,
      tooltip: 'El valor guardado en la variable.',
    },
  },

  // ─── Movimiento ───────────────────────────────────────────────────────
  {
    type: 'robot_move_forward',
    category: 'motion',
    requires: ['motion'],
    json: { message0: '⬆ avanzar %1 segundos', args0: [seconds('SECONDS', 1)], ...statement, tooltip: 'El robot va hacia delante.' },
  },
  {
    type: 'robot_move_backward',
    category: 'motion',
    requires: ['motion'],
    json: { message0: '⬇ retroceder %1 segundos', args0: [seconds('SECONDS', 1)], ...statement, tooltip: 'El robot va hacia atrás.' },
  },
  {
    type: 'robot_turn_left',
    category: 'motion',
    requires: ['motion'],
    json: { message0: '↶ girar a la izquierda %1 segundos', args0: [seconds('SECONDS', 0.5)], ...statement, tooltip: 'El robot gira sobre sí mismo hacia la izquierda.' },
  },
  {
    type: 'robot_turn_right',
    category: 'motion',
    requires: ['motion'],
    json: { message0: '↷ girar a la derecha %1 segundos', args0: [seconds('SECONDS', 0.5)], ...statement, tooltip: 'El robot gira sobre sí mismo hacia la derecha.' },
  },
  {
    type: 'robot_stop_motors',
    category: 'motion',
    requires: ['motion'],
    json: { message0: '■ detener motores', ...statement, tooltip: 'Para las ruedas.' },
  },
  {
    type: 'robot_set_speed',
    category: 'motion',
    requires: ['motion'],
    json: {
      message0: 'velocidad %1 %%',
      args0: [{ type: 'field_number', name: 'SPEED', value: 50, min: LIMITS.speed.min, max: LIMITS.speed.max, precision: 1 }],
      ...statement,
      tooltip: 'Elige lo rápido que se moverán las ruedas en los siguientes bloques (10 a 100 %).',
    },
  },

  // ─── Brazos ───────────────────────────────────────────────────────────
  {
    type: 'robot_shoulder_left',
    category: 'arms',
    requires: ['arms'],
    json: {
      message0: 'mover hombro izquierdo a %1 °',
      args0: [angle(90)],
      ...statement,
      tooltip: 'Sube o baja el brazo izquierdo (0 a 180 grados).',
    },
  },
  {
    type: 'robot_shoulder_right',
    category: 'arms',
    requires: ['arms'],
    json: {
      message0: 'mover hombro derecho a %1 °',
      args0: [angle(90)],
      ...statement,
      tooltip: 'Sube o baja el brazo derecho (0 a 180 grados).',
    },
  },
  {
    type: 'robot_gripper',
    category: 'arms',
    requires: ['arms'],
    json: {
      message0: '%1 pinza %2',
      args0: [
        { type: 'field_dropdown', name: 'ACTION', options: [['abrir', 'open'], ['cerrar', 'close']] },
        { type: 'field_dropdown', name: 'SIDE', options: SIDE_OPTIONS },
      ],
      ...statement,
      tooltip: 'Abre o cierra una pinza (gripper).',
    },
    toolbox: [
      { fields: { ACTION: 'open', SIDE: 'left' } },
      { fields: { ACTION: 'close', SIDE: 'left' } },
      { fields: { ACTION: 'open', SIDE: 'right' } },
      { fields: { ACTION: 'close', SIDE: 'right' } },
    ],
  },
  {
    type: 'robot_servo_angle',
    category: 'arms',
    requires: ['arms'],
    json: {
      message0: 'ajustar %1 a %2 °',
      args0: [
        {
          type: 'field_dropdown',
          name: 'SERVO',
          options: [
            ['hombro izquierdo', 'shoulder_left'],
            ['hombro derecho', 'shoulder_right'],
            ['pinza izquierda', 'gripper_left'],
            ['pinza derecha', 'gripper_right'],
          ],
        },
        angle(45),
      ],
      ...statement,
      tooltip: 'Coloca una articulación en un ángulo exacto (0 a 180 grados).',
    },
  },

  // ─── Sensores ─────────────────────────────────────────────────────────
  {
    type: 'robot_read_distance',
    category: 'sensors',
    requires: ['distance'],
    json: { message0: 'distancia (cm)', output: 'Number', tooltip: 'Lo lejos que está el obstáculo de delante, en centímetros.' },
  },
  {
    type: 'robot_distance_compare',
    category: 'sensors',
    requires: ['distance'],
    json: {
      message0: 'distancia %1 %2 cm',
      args0: [
        { type: 'field_dropdown', name: 'OP', options: [['<', '<'], ['>', '>']] },
        { type: 'field_number', name: 'CM', value: 20, min: 2, max: 400, precision: 1 },
      ],
      output: 'Boolean',
      tooltip: 'Comprueba si hay un obstáculo más cerca (<) o más lejos (>) que la distancia elegida.',
    },
  },
  {
    type: 'robot_read_color',
    category: 'sensors',
    requires: ['color_sensor'],
    json: { message0: 'color detectado', output: 'String', tooltip: 'El color que ve el sensor de la base.' },
  },
  {
    type: 'robot_color_is',
    category: 'sensors',
    requires: ['color_sensor'],
    json: {
      message0: 'color detectado es %1',
      args0: [
        {
          type: 'field_dropdown',
          name: 'COLOR',
          options: (['red', 'green', 'blue', 'yellow', 'black', 'white'] as const).map((c) => [COLOR_LABELS[c], c]),
        },
      ],
      output: 'Boolean',
      tooltip: 'Comprueba si el sensor ve el color elegido.',
    },
  },

  // ─── Luces y sonido (Módulo 2) ────────────────────────────────────────
  {
    type: 'robot_led_on',
    category: 'lights',
    requires: ['leds'],
    json: { message0: '💡 encender %1', args0: [{ type: 'field_dropdown', name: 'LED', options: LED_OPTIONS }], ...statement, tooltip: 'Enciende una luz.' },
  },
  {
    type: 'robot_led_off',
    category: 'lights',
    requires: ['leds'],
    json: { message0: 'apagar %1', args0: [{ type: 'field_dropdown', name: 'LED', options: LED_OPTIONS }], ...statement, tooltip: 'Apaga una luz.' },
  },
  {
    type: 'robot_led_toggle',
    category: 'lights',
    requires: ['leds'],
    json: {
      message0: 'cambiar %1',
      args0: [{ type: 'field_dropdown', name: 'LED', options: LED_OPTIONS }],
      ...statement,
      tooltip: 'Si la luz está encendida la apaga, y si está apagada la enciende.',
    },
  },
  {
    type: 'robot_beep',
    category: 'lights',
    requires: ['buzzer'],
    json: { message0: '🔔 pitar %1 segundos', args0: [seconds('SECONDS', 0.5, LIMITS.beepSeconds)], ...statement, tooltip: 'Hace sonar el zumbador.' },
  },
  {
    type: 'robot_tone',
    category: 'lights',
    requires: ['buzzer'],
    json: {
      message0: '🎵 tocar nota %1 durante %2 segundos',
      args0: [
        { type: 'field_dropdown', name: 'NOTE', options: NOTES.map(([label, hz]) => [label, String(hz)]) },
        seconds('SECONDS', 0.5, LIMITS.beepSeconds),
      ],
      ...statement,
      tooltip: 'Toca una nota musical.',
    },
  },

  // ─── Pantalla y botones (Módulo 3) ────────────────────────────────────
  {
    type: 'robot_display_text',
    category: 'display',
    requires: ['display'],
    json: {
      message0: '🖥 mostrar %1',
      args0: [{ type: 'field_input', name: 'TEXT', text: 'Hola' }],
      ...statement,
      tooltip: `Escribe un texto en la pantalla (máximo ${LIMITS.text.maxLength} letras).`,
    },
  },
  {
    type: 'robot_display_value',
    category: 'display',
    requires: ['display'],
    json: {
      message0: '🖥 mostrar valor %1',
      args0: [{ type: 'input_value', name: 'VALUE' }],
      ...statement,
      tooltip: 'Muestra en la pantalla un número, una variable o una lectura de un sensor.',
    },
    toolbox: [{ inputs: { VALUE: textShadow('Hola') } }],
  },
  {
    type: 'robot_display_clear',
    category: 'display',
    requires: ['display'],
    json: { message0: 'borrar pantalla', ...statement, tooltip: 'Deja la pantalla en blanco.' },
  },
  {
    type: 'robot_button_pressed',
    category: 'display',
    requires: ['buttons'],
    json: {
      message0: 'botón %1 presionado',
      args0: [{ type: 'field_dropdown', name: 'BUTTON', options: [['A', 'A'], ['B', 'B']] }],
      output: 'Boolean',
      tooltip: 'Verdadero mientras el botón está pulsado.',
    },
  },
];

export const BLOCKS_BY_TYPE: ReadonlyMap<string, RobotBlockDef> = new Map(BLOCKS.map((b) => [b.type, b]));

/** Definición completa en el formato que espera Blockly.defineBlocksWithJsonArray. */
export function toBlocklyJson(def: RobotBlockDef): Record<string, unknown> {
  return { type: def.type, colour: CATEGORY_COLOUR[def.category], ...def.json };
}

export function isBlockAvailable(def: RobotBlockDef, caps: ReadonlySet<Capability>): boolean {
  return def.requires.every((c) => caps.has(c));
}
