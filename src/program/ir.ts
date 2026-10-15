import { formatInstruction, type CommandName } from '../protocol/commands';
import type { ArgValue, ButtonName, Capability } from '../protocol/types';

/**
 * Representación intermedia (IR) del programa. Es lo que produce el
 * compilador de bloques y lo que ejecuta el motor. No contiene código
 * ejecutable: solo datos estructurados y validados.
 */

export const PROGRAM_FORMAT_VERSION = 1;

export type Value = number | string | boolean;

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type ArithOp = '+' | '-' | '*' | '/';

export type Expr =
  | { readonly kind: 'literal'; readonly value: Value }
  | { readonly kind: 'var'; readonly name: string }
  | { readonly kind: 'read_distance'; readonly blockId: string }
  | { readonly kind: 'read_color'; readonly blockId: string }
  | { readonly kind: 'read_button'; readonly button: ButtonName; readonly blockId: string }
  | { readonly kind: 'compare'; readonly op: CompareOp; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'logic'; readonly op: 'and' | 'or'; readonly left: Expr; readonly right: Expr }
  | { readonly kind: 'not'; readonly operand: Expr }
  | { readonly kind: 'arith'; readonly op: ArithOp; readonly left: Expr; readonly right: Expr };

export type MoveCommand = 'MOVE_FORWARD' | 'MOVE_BACKWARD' | 'TURN_LEFT' | 'TURN_RIGHT';

export type Stmt =
  /** Orden directa al robot con parámetros constantes ya validados. */
  | { readonly kind: 'command'; readonly cmd: CommandName; readonly args: Readonly<Record<string, ArgValue>>; readonly blockId: string }
  /** Movimiento que usa la velocidad actual del programa. */
  | { readonly kind: 'move'; readonly cmd: MoveCommand; readonly durationMs: number; readonly blockId: string }
  | { readonly kind: 'set_speed'; readonly speed: number; readonly blockId: string }
  /** Muestra en la OLED el resultado de una expresión. */
  | { readonly kind: 'display'; readonly value: Expr; readonly blockId: string }
  | { readonly kind: 'wait'; readonly ms: number; readonly blockId: string }
  | { readonly kind: 'repeat'; readonly times: number; readonly body: readonly Stmt[]; readonly blockId: string }
  | { readonly kind: 'forever'; readonly body: readonly Stmt[]; readonly blockId: string }
  | { readonly kind: 'if'; readonly cond: Expr; readonly then: readonly Stmt[]; readonly otherwise: readonly Stmt[] | null; readonly blockId: string }
  | { readonly kind: 'set_var'; readonly name: string; readonly value: Expr; readonly blockId: string }
  | { readonly kind: 'change_var'; readonly name: string; readonly delta: Expr; readonly blockId: string };

export interface Program {
  readonly formatVersion: typeof PROGRAM_FORMAT_VERSION;
  readonly body: readonly Stmt[];
  readonly requiredCapabilities: readonly Capability[];
}

export const DEFAULT_SPEED = 50;

// ─── Listado legible (pestaña «Instrucciones») ──────────────────────────────

export function formatExpr(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'string' ? JSON.stringify(e.value) : String(e.value);
    case 'var':
      return e.name;
    case 'read_distance':
      return 'READ_DISTANCE()';
    case 'read_color':
      return 'READ_COLOR()';
    case 'read_button':
      return `READ_BUTTON(button=${e.button})`;
    case 'compare':
    case 'arith':
      return `(${formatExpr(e.left)} ${e.op} ${formatExpr(e.right)})`;
    case 'logic':
      return `(${formatExpr(e.left)} ${e.op.toUpperCase()} ${formatExpr(e.right)})`;
    case 'not':
      return `NOT ${formatExpr(e.operand)}`;
  }
}

export function formatProgram(program: Program): string {
  const lines: string[] = ['ON_START'];
  const walk = (stmts: readonly Stmt[], depth: number): void => {
    const pad = '  '.repeat(depth);
    for (const s of stmts) {
      switch (s.kind) {
        case 'command':
          lines.push(pad + formatInstruction(s.cmd, s.args));
          break;
        case 'move':
          lines.push(`${pad}${s.cmd}(speed=<velocidad>, duration_ms=${s.durationMs})`);
          break;
        case 'set_speed':
          lines.push(`${pad}SET_SPEED(${s.speed})`);
          break;
        case 'display':
          lines.push(`${pad}DISPLAY_TEXT(text=${formatExpr(s.value)})`);
          break;
        case 'wait':
          lines.push(`${pad}WAIT(ms=${s.ms})`);
          break;
        case 'repeat':
          lines.push(`${pad}REPEAT(${s.times})`);
          walk(s.body, depth + 1);
          break;
        case 'forever':
          lines.push(`${pad}FOREVER`);
          walk(s.body, depth + 1);
          break;
        case 'if':
          lines.push(`${pad}IF ${formatExpr(s.cond)}`);
          walk(s.then, depth + 1);
          if (s.otherwise) {
            lines.push(`${pad}ELSE`);
            walk(s.otherwise, depth + 1);
          }
          break;
        case 'set_var':
          lines.push(`${pad}${s.name} = ${formatExpr(s.value)}`);
          break;
        case 'change_var':
          lines.push(`${pad}${s.name} += ${formatExpr(s.delta)}`);
          break;
      }
    }
  };
  walk(program.body, 1);
  return lines.join('\n');
}
