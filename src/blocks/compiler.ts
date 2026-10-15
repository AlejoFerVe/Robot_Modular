import { validateArgs, type CommandName } from '../protocol/commands';
import { capabilityOwner, type ArgValue, type Capability, type ColorName } from '../protocol/types';
import { PROGRAM_FORMAT_VERSION, type CompareOp, type Expr, type MoveCommand, type Program, type Stmt } from '../program/ir';
import { BLOCKS_BY_TYPE, COLOR_LABELS, LIMITS } from './definitions';

/**
 * Compilador: estado serializado del espacio de trabajo de Blockly → IR.
 * Trabaja sobre JSON plano (Blockly.serialization.workspaces.save), así que no
 * necesita el DOM y se puede probar sin navegador. Nunca genera código JS.
 */

export interface SerializedBlock {
  readonly type: string;
  readonly id?: string;
  readonly enabled?: boolean;
  readonly disabledReasons?: readonly string[];
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly inputs?: Readonly<Record<string, SerializedConnection>>;
  readonly next?: SerializedConnection;
}

export interface SerializedConnection {
  readonly block?: SerializedBlock;
  readonly shadow?: SerializedBlock;
}

export interface WorkspaceState {
  readonly blocks?: { readonly blocks?: readonly SerializedBlock[] };
  readonly variables?: readonly { readonly id: string; readonly name: string }[];
}

export interface CompileIssue {
  readonly blockId: string | null;
  readonly message: string;
}

export type CompileResult =
  | { readonly ok: true; readonly program: Program; readonly warnings: readonly CompileIssue[] }
  | { readonly ok: false; readonly errors: readonly CompileIssue[]; readonly warnings: readonly CompileIssue[] };

export const MODULE_NAMES = {
  base: 'la base (Módulo 1)',
  sensors: 'el módulo de sensores (Módulo 2)',
  interface: 'el módulo de pantalla (Módulo 3)',
} as const;

const MAX_NESTING = 32;

class CompileFailure extends Error {
  constructor(
    readonly blockId: string | null,
    message: string,
  ) {
    super(message);
  }
}

const isEnabled = (b: SerializedBlock): boolean =>
  b.enabled !== false && (b.disabledReasons === undefined || b.disabledReasons.length === 0);

const ON_START = 'robot_on_start';

export function compileWorkspace(state: WorkspaceState, caps: ReadonlySet<Capability>): CompileResult {
  const topBlocks = (state.blocks?.blocks ?? []).filter(isEnabled);
  const starts = topBlocks.filter((b) => b.type === ON_START);
  const warnings: CompileIssue[] = [];

  if (starts.length === 0) {
    return { ok: false, errors: [{ blockId: null, message: 'Falta el bloque «Al iniciar». Arrástralo desde Control.' }], warnings };
  }
  if (starts.length > 1) {
    return {
      ok: false,
      errors: starts.slice(1).map((b) => ({ blockId: b.id ?? null, message: 'Solo puede haber un bloque «Al iniciar».' })),
      warnings,
    };
  }
  for (const loose of topBlocks) {
    if (loose.type !== ON_START) {
      warnings.push({ blockId: loose.id ?? null, message: 'Este bloque está suelto y no se ejecutará.' });
    }
  }

  const ctx = new Context(state, caps);
  const start = starts[0] as SerializedBlock;
  const body = ctx.chain(start.next?.block, 0);
  if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors, warnings };
  if (body.length === 0) {
    warnings.push({ blockId: null, message: 'Tu programa está vacío: pon bloques debajo de «Al iniciar».' });
  }
  return {
    ok: true,
    program: { formatVersion: PROGRAM_FORMAT_VERSION, body, requiredCapabilities: [...ctx.used] },
    warnings,
  };
}

class Context {
  readonly errors: CompileIssue[] = [];
  readonly used = new Set<Capability>();
  private readonly varNames: ReadonlyMap<string, string>;

  constructor(
    state: WorkspaceState,
    private readonly caps: ReadonlySet<Capability>,
  ) {
    this.varNames = new Map((state.variables ?? []).map((v) => [v.id, v.name]));
  }

  /** Compila una cadena de bloques unidos por "next". Recoge errores sin detenerse. */
  chain(first: SerializedBlock | undefined, depth: number): Stmt[] {
    const out: Stmt[] = [];
    let block = first;
    while (block) {
      if (isEnabled(block)) {
        try {
          out.push(this.stmt(block, depth));
        } catch (e) {
          if (!(e instanceof CompileFailure)) throw e;
          this.errors.push({ blockId: e.blockId, message: e.message });
        }
      }
      block = block.next?.block;
    }
    return out;
  }

  private id(b: SerializedBlock): string {
    return b.id ?? '';
  }

  private fail(b: SerializedBlock, message: string): never {
    throw new CompileFailure(b.id ?? null, message);
  }

  private checkCaps(b: SerializedBlock): void {
    const def = BLOCKS_BY_TYPE.get(b.type);
    if (!def) this.fail(b, 'Este bloque no es compatible con esta versión de la aplicación.');
    for (const cap of def.requires) {
      if (!this.caps.has(cap)) {
        this.fail(b, `Este bloque necesita ${MODULE_NAMES[capabilityOwner(cap)]}, que no está disponible.`);
      }
      this.used.add(cap);
    }
  }

  private num(b: SerializedBlock, field: string, min: number, max: number, label: string): number {
    const raw = b.fields?.[field];
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) this.fail(b, `Escribe un número en «${label}».`);
    if (value < min || value > max) this.fail(b, `«${label}» debe estar entre ${min} y ${max}.`);
    return value;
  }

  private str(b: SerializedBlock, field: string): string {
    const raw = b.fields?.[field];
    if (typeof raw !== 'string') this.fail(b, 'Falta elegir una opción.');
    return raw;
  }

  private variable(b: SerializedBlock): string {
    const raw = b.fields?.['VAR'];
    if (typeof raw === 'object' && raw !== null) {
      const { id, name } = raw as { id?: unknown; name?: unknown };
      if (typeof id === 'string' && this.varNames.has(id)) return this.varNames.get(id) as string;
      if (typeof name === 'string' && name.length > 0) return name;
    }
    this.fail(b, 'Elige una variable.');
  }

  private input(b: SerializedBlock, name: string): SerializedBlock {
    const conn = b.inputs?.[name];
    const child = conn?.block ?? conn?.shadow;
    if (!child) this.fail(b, 'A este bloque le falta un valor. Encaja un bloque en el hueco.');
    return child;
  }

  private body(b: SerializedBlock, name: string, depth: number): Stmt[] {
    if (depth >= MAX_NESTING) this.fail(b, 'Hay demasiados bloques uno dentro de otro.');
    return this.chain(b.inputs?.[name]?.block, depth + 1);
  }

  private command(b: SerializedBlock, cmd: CommandName, args: Record<string, ArgValue>): Stmt {
    const issues = validateArgs(cmd, args);
    if (issues.length > 0) this.fail(b, `Valor no válido: ${issues.map((i) => i.reason).join(', ')}.`);
    return { kind: 'command', cmd, args, blockId: this.id(b) };
  }

  private ms(seconds: number): number {
    return Math.round(seconds * 1000);
  }

  stmt(b: SerializedBlock, depth: number): Stmt {
    this.checkCaps(b);
    const blockId = this.id(b);
    const moves: Record<string, MoveCommand> = {
      robot_move_forward: 'MOVE_FORWARD',
      robot_move_backward: 'MOVE_BACKWARD',
      robot_turn_left: 'TURN_LEFT',
      robot_turn_right: 'TURN_RIGHT',
    };

    switch (b.type) {
      case 'robot_move_forward':
      case 'robot_move_backward':
      case 'robot_turn_left':
      case 'robot_turn_right': {
        const s = this.num(b, 'SECONDS', LIMITS.seconds.min, LIMITS.seconds.max, 'segundos');
        return { kind: 'move', cmd: moves[b.type] as MoveCommand, durationMs: this.ms(s), blockId };
      }
      case 'robot_stop_motors':
        return this.command(b, 'STOP_MOTORS', {});
      case 'robot_set_speed':
        return { kind: 'set_speed', speed: Math.round(this.num(b, 'SPEED', LIMITS.speed.min, LIMITS.speed.max, 'velocidad')), blockId };

      case 'robot_shoulder_left':
      case 'robot_shoulder_right':
        return this.command(b, 'SET_SERVO', {
          servo: b.type === 'robot_shoulder_left' ? 'shoulder_left' : 'shoulder_right',
          angle: Math.round(this.num(b, 'ANGLE', LIMITS.angle.min, LIMITS.angle.max, 'ángulo')),
        });
      case 'robot_gripper':
        return this.command(b, 'GRIPPER', { side: this.str(b, 'SIDE'), action: this.str(b, 'ACTION') });
      case 'robot_servo_angle':
        return this.command(b, 'SET_SERVO', {
          servo: this.str(b, 'SERVO'),
          angle: Math.round(this.num(b, 'ANGLE', LIMITS.angle.min, LIMITS.angle.max, 'ángulo')),
        });

      case 'robot_led_on':
      case 'robot_led_off':
        return this.command(b, 'SET_LED', { led: this.num(b, 'LED', 0, 4, 'LED'), on: b.type === 'robot_led_on' });
      case 'robot_led_toggle':
        return this.command(b, 'TOGGLE_LED', { led: this.num(b, 'LED', 0, 4, 'LED') });
      case 'robot_beep': {
        const s = this.num(b, 'SECONDS', LIMITS.beepSeconds.min, LIMITS.beepSeconds.max, 'segundos');
        return this.command(b, 'BEEP', { duration_ms: this.ms(s) });
      }
      case 'robot_tone': {
        const s = this.num(b, 'SECONDS', LIMITS.beepSeconds.min, LIMITS.beepSeconds.max, 'segundos');
        return this.command(b, 'PLAY_TONE', { freq_hz: this.num(b, 'NOTE', 100, 5000, 'nota'), duration_ms: this.ms(s) });
      }

      case 'robot_display_text': {
        const text = this.str(b, 'TEXT');
        if (text.length > LIMITS.text.maxLength) this.fail(b, `El texto es muy largo (máximo ${LIMITS.text.maxLength} letras).`);
        return this.command(b, 'DISPLAY_TEXT', { text });
      }
      case 'robot_display_value':
        return { kind: 'display', value: this.expr(this.input(b, 'VALUE'), depth), blockId };
      case 'robot_display_clear':
        return this.command(b, 'DISPLAY_CLEAR', {});

      case 'robot_wait':
        return { kind: 'wait', ms: this.ms(this.num(b, 'SECONDS', LIMITS.waitSeconds.min, LIMITS.waitSeconds.max, 'segundos')), blockId };
      case 'robot_repeat':
        return {
          kind: 'repeat',
          times: Math.round(this.num(b, 'TIMES', LIMITS.repeat.min, LIMITS.repeat.max, 'veces')),
          body: this.body(b, 'DO', depth),
          blockId,
        };
      case 'robot_forever':
        return { kind: 'forever', body: this.body(b, 'DO', depth), blockId };
      case 'robot_if':
        return { kind: 'if', cond: this.expr(this.input(b, 'COND'), depth), then: this.body(b, 'DO', depth), otherwise: null, blockId };
      case 'robot_if_else':
        return {
          kind: 'if',
          cond: this.expr(this.input(b, 'COND'), depth),
          then: this.body(b, 'DO', depth),
          otherwise: this.body(b, 'ELSE', depth),
          blockId,
        };
      case 'robot_var_set':
        return { kind: 'set_var', name: this.variable(b), value: this.expr(this.input(b, 'VALUE'), depth), blockId };
      case 'robot_var_change':
        return { kind: 'change_var', name: this.variable(b), delta: this.expr(this.input(b, 'DELTA'), depth), blockId };

      case ON_START:
        return this.fail(b, 'Solo puede haber un bloque «Al iniciar».');
      default:
        return this.fail(b, 'Este bloque no se puede usar como instrucción.');
    }
  }

  expr(b: SerializedBlock, depth: number): Expr {
    if (depth >= MAX_NESTING) this.fail(b, 'Hay demasiados bloques uno dentro de otro.');
    if (!isEnabled(b)) this.fail(b, 'Este bloque está desactivado.');
    this.checkCaps(b);
    const blockId = this.id(b);
    const sub = (name: string): Expr => this.expr(this.input(b, name), depth + 1);

    switch (b.type) {
      case 'robot_number':
        return { kind: 'literal', value: this.num(b, 'NUM', -10000, 10000, 'número') };
      case 'robot_text': {
        const text = this.str(b, 'TEXT');
        if (text.length > LIMITS.text.maxLength) this.fail(b, `El texto es muy largo (máximo ${LIMITS.text.maxLength} letras).`);
        return { kind: 'literal', value: text };
      }
      case 'robot_bool':
        return { kind: 'literal', value: this.str(b, 'BOOL') === 'true' };
      case 'robot_var_get':
        return { kind: 'var', name: this.variable(b) };
      case 'robot_compare': {
        const op = this.str(b, 'OP');
        if (!['<', '<=', '>', '>=', '==', '!='].includes(op)) this.fail(b, 'Comparación no válida.');
        return { kind: 'compare', op: op as CompareOp, left: sub('A'), right: sub('B') };
      }
      case 'robot_logic': {
        const op = this.str(b, 'OP');
        if (op !== 'and' && op !== 'or') this.fail(b, 'Operación no válida.');
        return { kind: 'logic', op, left: sub('A'), right: sub('B') };
      }
      case 'robot_not':
        return { kind: 'not', operand: sub('A') };
      case 'robot_arith': {
        const op = this.str(b, 'OP');
        if (op !== '+' && op !== '-' && op !== '*' && op !== '/') this.fail(b, 'Operación no válida.');
        return { kind: 'arith', op, left: sub('A'), right: sub('B') };
      }
      case 'robot_read_distance':
        return { kind: 'read_distance', blockId };
      case 'robot_distance_compare': {
        const op = this.str(b, 'OP');
        if (op !== '<' && op !== '>') this.fail(b, 'Comparación no válida.');
        return { kind: 'compare', op, left: { kind: 'read_distance', blockId }, right: { kind: 'literal', value: this.num(b, 'CM', 2, 400, 'cm') } };
      }
      case 'robot_read_color':
        return { kind: 'read_color', blockId };
      case 'robot_color_is': {
        const color = this.str(b, 'COLOR');
        if (!Object.hasOwn(COLOR_LABELS, color)) this.fail(b, 'Color no válido.');
        return {
          kind: 'compare',
          op: '==',
          left: { kind: 'read_color', blockId },
          right: { kind: 'literal', value: COLOR_LABELS[color as ColorName] },
        };
      }
      case 'robot_button_pressed': {
        const button = this.str(b, 'BUTTON');
        if (button !== 'A' && button !== 'B') this.fail(b, 'Botón no válido.');
        return { kind: 'read_button', button, blockId };
      }
      default:
        return this.fail(b, 'Este bloque no da un valor; no puede ir en un hueco.');
    }
  }
}
