import { MODULE_NAMES } from '../blocks/compiler';
import { capabilityOwner, type Capability } from '../protocol/types';
import type { Program } from '../program/ir';
import type { RobotSession } from '../robot/RobotSession';
import type { Unsubscribe } from '../transport/Transport';
import { ProgramRunner, type RunEvent, type RunOutcome, type RunnerOptions } from './ProgramRunner';

export type ExecutionState = 'idle' | 'running' | 'stopping';

export interface LogEntry extends Readonly<{ id: number; time: number }> {
  readonly event: RunEvent;
}

export interface ExecutionSnapshot {
  readonly state: ExecutionState;
  readonly activeBlockId: string | null;
  /** Bloque donde ocurrió el último error, para señalarlo en el editor. */
  readonly errorBlockId: string | null;
  readonly log: readonly LogEntry[];
  readonly lastOutcome: RunOutcome | null;
}

const MAX_LOG = 200;

/**
 * Aplica la política de seguridad alrededor del motor:
 *  - Si se pierde la comunicación, el programa se detiene.
 *  - Si se desconecta un módulo que el programa usa, el programa se detiene
 *    y se envía STOP al robot.
 *  - Al detener o fallar, siempre se envía STOP (motores y actuadores a reposo).
 */
export class ExecutionController {
  private readonly runner: ProgramRunner;
  private snapshot: ExecutionSnapshot = { state: 'idle', activeBlockId: null, errorBlockId: null, log: [], lastOutcome: null };
  private readonly listeners = new Set<() => void>();
  private readonly subs: Unsubscribe[];
  private current: Program | null = null;
  private nextLogId = 1;

  constructor(
    private readonly session: RobotSession,
    options: RunnerOptions = {},
  ) {
    this.runner = new ProgramRunner(session, options);
    this.subs = [
      session.onLinkLost(() => this.runner.abort('Se perdió la comunicación con el robot. El programa se detuvo.')),
      session.onCapabilitiesLost((caps) => this.handleCapabilitiesLost(caps)),
    ];
  }

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ExecutionSnapshot => this.snapshot;

  private set(patch: Partial<ExecutionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  log(event: RunEvent): void {
    const entry: LogEntry = { id: this.nextLogId++, time: Date.now(), event };
    this.set({ log: [...this.snapshot.log, entry].slice(-MAX_LOG) });
  }

  clearLog(): void {
    this.set({ log: [] });
  }

  async run(program: Program): Promise<RunOutcome> {
    if (this.runner.isRunning) throw new Error('Ya hay un programa en ejecución.');
    this.current = program;
    this.set({ state: 'running', activeBlockId: null, errorBlockId: null, lastOutcome: null });
    const outcome = await this.runner.run(program, {
      onBlock: (blockId) => this.set({ activeBlockId: blockId }),
      onEvent: (event) => this.log(event),
    });
    this.current = null;
    if (outcome.status !== 'finished') await this.sendStop();
    this.set({
      state: 'idle',
      activeBlockId: null,
      errorBlockId: outcome.status === 'error' ? outcome.blockId : null,
      lastOutcome: outcome,
    });
    return outcome;
  }

  /** Botón «Detener»: corta el programa y ordena al robot parar ya. */
  async stop(): Promise<void> {
    if (this.runner.isRunning) {
      this.set({ state: 'stopping' });
      // STOP se envía en paralelo para no esperar a que termine la orden en curso.
      void this.sendStop();
      this.runner.stop();
    } else {
      await this.sendStop();
    }
  }

  dispose(): void {
    this.runner.stop();
    for (const unsubscribe of this.subs) unsubscribe();
  }

  private handleCapabilitiesLost(caps: Capability[]): void {
    if (!this.current || !this.runner.isRunning) return;
    const used = caps.filter((c) => this.current?.requiredCapabilities.includes(c));
    if (used.length === 0) return;
    const module = MODULE_NAMES[capabilityOwner(used[0] as Capability)];
    this.runner.abort(`Se desconectó ${module}, que tu programa necesita. El robot se detuvo por seguridad.`);
  }

  private async sendStop(): Promise<void> {
    if (this.session.getSnapshot().link !== 'connected') return;
    try {
      await this.session.request('STOP', {});
    } catch {
      this.log({ level: 'error', text: 'No se pudo confirmar que el robot se detuviera. Si sigue moviéndose, apágalo.' });
    }
  }
}
