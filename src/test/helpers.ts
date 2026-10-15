import { RobotSession } from '../robot/RobotSession';
import { SimulatedRobot, type SimulatorOptions } from '../simulator/SimulatedRobot';
import { SimulatorTransport } from '../simulator/SimulatorTransport';
import { Emitter, type Transport, type Unsubscribe } from '../transport/Transport';

/** Opciones rápidas para pruebas (tiempos cortos). */
export const FAST_CLIENT = { ackTimeoutMs: 80, doneMarginMs: 80, linkTimeoutMs: 250, pingIntervalMs: 40 } as const;

export function fastSimulator(options: SimulatorOptions = {}): { robot: SimulatedRobot; transport: SimulatorTransport } {
  const robot = new SimulatedRobot({ timeScale: 0.01, statusIntervalMs: 40, ...options });
  return { robot, transport: new SimulatorTransport(robot) };
}

export async function connectedSession(options: SimulatorOptions = {}) {
  const sim = fastSimulator(options);
  const session = new RobotSession(FAST_CLIENT);
  await session.connect(sim.transport);
  return { session, ...sim };
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: tiempo agotado');
    await delay(5);
  }
}

/**
 * Transporte programable: cada línea enviada se pasa a `respond`, que devuelve
 * las líneas que el "robot" contestará.
 */
export class ScriptedTransport implements Transport {
  readonly kind = 'serial' as const;
  readonly label = 'Prueba';
  readonly sent: Record<string, unknown>[] = [];
  private readonly data = new Emitter<string>();
  private readonly closed = new Emitter<string>();

  constructor(private readonly respond: (req: Record<string, unknown>) => string[]) {}

  async open(): Promise<void> {}

  async write(line: string): Promise<void> {
    const req = JSON.parse(line) as Record<string, unknown>;
    this.sent.push(req);
    const replies = this.respond(req);
    setTimeout(() => {
      for (const reply of replies) this.data.emit(reply + '\n');
    }, 1);
  }

  push(line: string): void {
    this.data.emit(line + '\n');
  }

  async close(): Promise<void> {
    this.closed.emit('cerrado');
  }

  onData(listener: (chunk: string) => void): Unsubscribe {
    return this.data.on(listener);
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    return this.closed.on(listener);
  }
}

export const helloReply = (id: unknown, protocol = '1.0'): string =>
  JSON.stringify({
    v: 1,
    type: 'done',
    id,
    result: {
      protocol,
      robot: 'test',
      firmware: '0.0.1',
      modules: [{ type: 'base', typeId: 1, firmware: '0.0.1', capabilities: ['motion'], state: 'ok' }],
    },
  });
