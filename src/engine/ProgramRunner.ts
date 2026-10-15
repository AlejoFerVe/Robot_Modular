import { COMMANDS, formatInstruction, parseButtonResult, parseColorResult, parseDistanceResult, type CommandName } from '../protocol/commands';
import { capabilityOwner, type Args, type Capability } from '../protocol/types';
import { COLOR_LABELS } from '../blocks/definitions';
import { MODULE_NAMES } from '../blocks/compiler';
import { DEFAULT_SPEED, type CompareOp, type Expr, type Program, type Stmt, type Value } from '../program/ir';
import { RobotError } from '../robot/errors';

/**
 * Motor de ejecución. Recorre la IR paso a paso: cada orden espera la
 * confirmación del robot antes de pasar a la siguiente. Se puede detener en
 * cualquier momento (incluidas esperas y órdenes en curso).
 */

export interface ExecutionHost {
  request(cmd: CommandName, args: Args): Promise<Readonly<Record<string, unknown>>>;
  hasCapability(cap: Capability): boolean;
}

export type RunEvent =
  | { readonly level: 'info'; readonly text: string }
  | { readonly level: 'command'; readonly text: string }
  | { readonly level: 'error'; readonly text: string };

export interface RunCallbacks {
  /** Bloque que se está ejecutando (para resaltarlo), o null al terminar. */
  onBlock?(blockId: string | null): void;
  onEvent?(event: RunEvent): void;
}

export type RunOutcome =
  | { readonly status: 'finished' }
  | { readonly status: 'stopped' }
  | { readonly status: 'error'; readonly message: string; readonly blockId: string | null };

export interface RunnerOptions {
  /** Pausa mínima en cada vuelta de un bucle para no bloquear la interfaz. */
  readonly loopDelayMs?: number;
}

class StopSignal extends Error {}

class RuntimeError extends Error {
  constructor(
    message: string,
    readonly blockId: string | null,
  ) {
    super(message);
  }
}

const DISPLAY_MAX = 32;

export function formatDisplayValue(value: Value): string {
  let text: string;
  if (typeof value === 'boolean') text = value ? 'verdadero' : 'falso';
  else if (typeof value === 'number') text = String(Math.round(value * 100) / 100);
  else text = value;
  return text.slice(0, DISPLAY_MAX);
}

export class ProgramRunner {
  private controller: AbortController | null = null;
  private abortReason: RuntimeError | null = null;
  private readonly loopDelayMs: number;

  constructor(
    private readonly host: ExecutionHost,
    options: RunnerOptions = {},
  ) {
    this.loopDelayMs = options.loopDelayMs ?? 20;
  }

  get isRunning(): boolean {
    return this.controller !== null;
  }

  /** Detención pedida por el usuario. */
  stop(): void {
    this.controller?.abort();
  }

  /** Detención por un problema externo (p. ej. un módulo desconectado). */
  abort(message: string): void {
    if (!this.controller) return;
    this.abortReason = new RuntimeError(message, null);
    this.controller.abort();
  }

  async run(program: Program, callbacks: RunCallbacks = {}): Promise<RunOutcome> {
    if (this.controller) throw new Error('Ya hay un programa en ejecución.');
    const controller = new AbortController();
    this.controller = controller;
    this.abortReason = null;
    const exec = new Execution(this.host, controller.signal, callbacks, this.loopDelayMs);

    let outcome: RunOutcome;
    try {
      for (const cap of program.requiredCapabilities) {
        if (!this.host.hasCapability(cap)) {
          throw new RuntimeError(`El programa necesita ${MODULE_NAMES[capabilityOwner(cap)]}, que no está disponible.`, null);
        }
      }
      callbacks.onEvent?.({ level: 'info', text: '▶ Programa iniciado' });
      await exec.block(program.body);
      outcome = { status: 'finished' };
      callbacks.onEvent?.({ level: 'info', text: '✔ Programa terminado' });
    } catch (error) {
      outcome = this.toOutcome(error, controller.signal);
      if (outcome.status === 'error') callbacks.onEvent?.({ level: 'error', text: outcome.message });
      else callbacks.onEvent?.({ level: 'info', text: '■ Programa detenido' });
    } finally {
      this.controller = null;
      callbacks.onBlock?.(null);
    }
    return outcome;
  }

  private toOutcome(error: unknown, signal: AbortSignal): RunOutcome {
    if (this.abortReason) return { status: 'error', message: this.abortReason.message, blockId: null };
    if (signal.aborted || error instanceof StopSignal) return { status: 'stopped' };
    if (error instanceof RuntimeError) return { status: 'error', message: error.message, blockId: error.blockId };
    if (error instanceof RobotError) return { status: 'error', message: error.message, blockId: null };
    return { status: 'error', message: 'Ocurrió un error inesperado al ejecutar el programa.', blockId: null };
  }
}

class Execution {
  private readonly vars = new Map<string, Value>();
  private speed = DEFAULT_SPEED;

  constructor(
    private readonly host: ExecutionHost,
    private readonly signal: AbortSignal,
    private readonly callbacks: RunCallbacks,
    private readonly loopDelayMs: number,
  ) {}

  private checkStop(): void {
    if (this.signal.aborted) throw new StopSignal();
  }

  /** Espera una promesa, pero sale en cuanto se pide detener. */
  private abortable<T>(promise: Promise<T>): Promise<T> {
    this.checkStop();
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new StopSignal());
      this.signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (v) => {
          this.signal.removeEventListener('abort', onAbort);
          resolve(v);
        },
        (e: unknown) => {
          this.signal.removeEventListener('abort', onAbort);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    return this.abortable(new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async send(cmd: CommandName, args: Args, blockId: string): Promise<Readonly<Record<string, unknown>>> {
    const cap = COMMANDS[cmd].capability;
    const unavailable = (): RuntimeError =>
      new RuntimeError(`${capitalize(MODULE_NAMES[capabilityOwner(cap as Capability)])} no está disponible.`, blockId);
    // No se envían órdenes a un módulo que ya no está disponible.
    if (cap && !this.host.hasCapability(cap)) throw unavailable();
    this.callbacks.onEvent?.({ level: 'command', text: formatInstruction(cmd, args) });
    try {
      return await this.abortable(this.host.request(cmd, args));
    } catch (error) {
      if (error instanceof RobotError) {
        throw error.code === 'MODULE_UNAVAILABLE' && cap ? unavailable() : new RuntimeError(error.message, blockId);
      }
      throw error;
    }
  }

  async block(stmts: readonly Stmt[]): Promise<void> {
    for (const s of stmts) {
      this.checkStop();
      this.callbacks.onBlock?.(s.blockId);
      await this.stmt(s);
    }
  }

  private async stmt(s: Stmt): Promise<void> {
    switch (s.kind) {
      case 'command':
        await this.send(s.cmd, s.args, s.blockId);
        return;
      case 'move':
        await this.send(s.cmd, { speed: this.speed, duration_ms: s.durationMs }, s.blockId);
        return;
      case 'set_speed':
        this.speed = s.speed;
        return;
      case 'display': {
        const value = await this.eval(s.value);
        await this.send('DISPLAY_TEXT', { text: formatDisplayValue(value) }, s.blockId);
        return;
      }
      case 'wait':
        await this.sleep(s.ms);
        return;
      case 'repeat':
        for (let i = 0; i < s.times; i++) {
          await this.block(s.body);
          await this.sleep(this.loopDelayMs);
        }
        return;
      case 'forever':
        for (;;) {
          await this.block(s.body);
          await this.sleep(this.loopDelayMs);
        }
      case 'if': {
        const cond = await this.eval(s.cond);
        if (typeof cond !== 'boolean') throw new RuntimeError('La condición debe ser verdadera o falsa.', s.blockId);
        if (cond) await this.block(s.then);
        else if (s.otherwise) await this.block(s.otherwise);
        return;
      }
      case 'set_var':
        this.vars.set(s.name, await this.eval(s.value));
        return;
      case 'change_var': {
        const current = this.vars.get(s.name) ?? 0;
        const delta = await this.eval(s.delta);
        if (typeof current !== 'number' || typeof delta !== 'number') {
          throw new RuntimeError(`Solo se pueden sumar números a «${s.name}».`, s.blockId);
        }
        this.vars.set(s.name, current + delta);
        return;
      }
    }
  }

  async eval(e: Expr): Promise<Value> {
    switch (e.kind) {
      case 'literal':
        return e.value;
      case 'var':
        // Una variable que aún no se ha usado vale 0.
        return this.vars.get(e.name) ?? 0;
      case 'read_distance': {
        const cm = parseDistanceResult(await this.send('READ_DISTANCE', {}, e.blockId));
        if (cm === null) throw new RuntimeError('El sensor de distancia envió una lectura no válida.', e.blockId);
        return cm;
      }
      case 'read_color': {
        const color = parseColorResult(await this.send('READ_COLOR', {}, e.blockId));
        if (color === null) throw new RuntimeError('El sensor de color envió una lectura no válida.', e.blockId);
        return COLOR_LABELS[color];
      }
      case 'read_button': {
        const pressed = parseButtonResult(await this.send('READ_BUTTON', { button: e.button }, e.blockId));
        if (pressed === null) throw new RuntimeError('El botón envió una lectura no válida.', e.blockId);
        return pressed;
      }
      case 'not': {
        const v = await this.eval(e.operand);
        if (typeof v !== 'boolean') throw new RuntimeError('«no» necesita una condición.', null);
        return !v;
      }
      case 'logic': {
        const left = await this.eval(e.left);
        if (typeof left !== 'boolean') throw new RuntimeError(`«${e.op === 'and' ? 'y' : 'o'}» necesita condiciones.`, null);
        if (e.op === 'and' && !left) return false;
        if (e.op === 'or' && left) return true;
        const right = await this.eval(e.right);
        if (typeof right !== 'boolean') throw new RuntimeError(`«${e.op === 'and' ? 'y' : 'o'}» necesita condiciones.`, null);
        return right;
      }
      case 'compare':
        return compare(e.op, await this.eval(e.left), await this.eval(e.right));
      case 'arith': {
        const left = await this.eval(e.left);
        const right = await this.eval(e.right);
        if (typeof left !== 'number' || typeof right !== 'number') throw new RuntimeError('Solo se puede operar con números.', null);
        switch (e.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            if (right === 0) throw new RuntimeError('No se puede dividir entre cero.', null);
            return left / right;
        }
      }
    }
  }
}

function compare(op: CompareOp, left: Value, right: Value): boolean {
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new RuntimeError('Solo se pueden comparar números con <, >, ≤ o ≥.', null);
  }
  switch (op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
