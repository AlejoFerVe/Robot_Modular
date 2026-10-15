import { COMMANDS, formatInstruction, validateArgs, type CommandName } from '../protocol/commands';
import {
  APP_PROTOCOL_STRING,
  LineBuffer,
  decodeLine,
  encodeRequest,
  isProtocolCompatible,
  parseHelloResult,
  parseModuleList,
} from '../protocol/codec';
import type { Args, HelloResult, ModuleReport, RobotMessage } from '../protocol/types';
import { Emitter, type Transport, type Unsubscribe } from '../transport/Transport';
import { RobotError } from './errors';

export interface RobotClientOptions {
  /** Tiempo máximo para recibir "ack" tras enviar una petición. */
  readonly ackTimeoutMs?: number;
  /** Margen añadido a la duración esperada para recibir "done". */
  readonly doneMarginMs?: number;
  /** Sin ningún mensaje del robot durante este tiempo se considera el enlace perdido. */
  readonly linkTimeoutMs?: number;
  /** Intervalo de PING (también alimenta la vigilancia del firmware). */
  readonly pingIntervalMs?: number;
}

export type Result = Readonly<Record<string, unknown>>;

interface Pending {
  readonly cmd: CommandName;
  readonly args: Args;
  acked: boolean;
  timer: ReturnType<typeof setTimeout>;
  resolve(result: Result): void;
  reject(error: RobotError): void;
}

export interface TrafficEntry {
  readonly direction: 'out' | 'in' | 'warn';
  readonly text: string;
}

/**
 * Cliente del protocolo. Garantiza que cada orden se confirme (ack → done),
 * aplica tiempos máximos y detecta la pérdida del enlace. Nunca da por
 * ejecutada una orden sin una respuesta válida del robot.
 */
export class RobotClient {
  private readonly opts: Required<RobotClientOptions>;
  private readonly lines = new LineBuffer();
  private readonly pending = new Map<number, Pending>();
  private readonly modulesChanged = new Emitter<readonly ModuleReport[]>();
  private readonly linkLost = new Emitter<string>();
  private readonly traffic = new Emitter<TrafficEntry>();
  private subscriptions: Unsubscribe[] = [];
  private nextId = 1;
  private lastRxAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private connected = false;

  constructor(
    readonly transport: Transport,
    options: RobotClientOptions = {},
  ) {
    this.opts = {
      ackTimeoutMs: options.ackTimeoutMs ?? 1000,
      doneMarginMs: options.doneMarginMs ?? 1500,
      linkTimeoutMs: options.linkTimeoutMs ?? 3500,
      pingIntervalMs: options.pingIntervalMs ?? 1000,
    };
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Abre el transporte, hace el saludo y comprueba la versión del protocolo. */
  async connect(): Promise<HelloResult> {
    this.subscriptions = [
      this.transport.onData((chunk) => this.handleChunk(chunk)),
      this.transport.onClose((reason) => this.fail(reason)),
    ];
    try {
      await this.transport.open();
    } catch (error) {
      for (const unsubscribe of this.subscriptions) unsubscribe();
      this.subscriptions = [];
      throw error;
    }
    this.connected = true;
    this.lastRxAt = Date.now();

    let hello: HelloResult;
    try {
      const raw = await this.request('HELLO', { app_protocol: APP_PROTOCOL_STRING });
      const parsed = parseHelloResult(raw);
      if (!parsed) throw new RobotError('BAD_RESPONSE', 'saludo no válido');
      if (!isProtocolCompatible(parsed.protocol)) {
        throw new RobotError('INCOMPATIBLE', `(robot: ${parsed.protocol}, app: ${APP_PROTOCOL_STRING})`);
      }
      hello = parsed;
    } catch (error) {
      await this.disconnect();
      throw error;
    }

    this.watchdog = setInterval(() => this.checkLink(), Math.min(500, this.opts.linkTimeoutMs / 2));
    this.pinger = setInterval(() => {
      this.request('PING', {}).catch(() => undefined);
    }, this.opts.pingIntervalMs);
    return hello;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.teardown(new RobotError('NOT_CONNECTED'));
    await this.transport.close();
  }

  async getModules(): Promise<ModuleReport[]> {
    const result = await this.request('GET_MODULES', {});
    const modules = parseModuleList(result['modules']);
    if (!modules) throw new RobotError('BAD_RESPONSE', 'lista de módulos no válida');
    return modules;
  }

  /**
   * Envía una orden y espera su confirmación final. Los parámetros se validan
   * antes de enviarse; un valor fuera de rango nunca llega al robot.
   */
  request(cmd: CommandName, args: Args): Promise<Result> {
    if (!this.connected) return Promise.reject(new RobotError('NOT_CONNECTED'));
    const argErrors = validateArgs(cmd, args);
    if (argErrors.length > 0) {
      const detail = argErrors.map((e) => `${e.arg}: ${e.reason}`).join('; ');
      return Promise.reject(new RobotError('INVALID_ARGS', detail));
    }

    const id = this.nextId++;
    return new Promise<Result>((resolve, reject) => {
      const entry: Pending = {
        cmd,
        args,
        acked: false,
        timer: setTimeout(() => this.timeout(id), this.opts.ackTimeoutMs),
        resolve,
        reject,
      };
      this.pending.set(id, entry);
      if (cmd !== 'PING') this.traffic.emit({ direction: 'out', text: formatInstruction(cmd, args) });
      this.transport.write(encodeRequest(id, cmd, args)).catch(() => {
        this.settle(id, new RobotError('LINK_LOST'));
      });
    });
  }

  onModules(listener: (modules: readonly ModuleReport[]) => void): Unsubscribe {
    return this.modulesChanged.on(listener);
  }

  onLinkLost(listener: (reason: string) => void): Unsubscribe {
    return this.linkLost.on(listener);
  }

  onTraffic(listener: (entry: TrafficEntry) => void): Unsubscribe {
    return this.traffic.on(listener);
  }

  // ─── Recepción ────────────────────────────────────────────────────────

  private handleChunk(chunk: string): void {
    for (const line of this.lines.push(chunk)) {
      const decoded = decodeLine(line);
      if (!decoded.ok) {
        // Un mensaje ilegible no confirma nada: la petición afectada expirará.
        this.traffic.emit({ direction: 'warn', text: `Mensaje ignorado (${decoded.reason})` });
        continue;
      }
      this.lastRxAt = Date.now();
      this.handleMessage(decoded.message);
    }
  }

  private handleMessage(msg: RobotMessage): void {
    switch (msg.type) {
      case 'evt':
        if (msg.evt === 'modules') this.modulesChanged.emit(msg.modules);
        return;
      case 'ack': {
        const entry = this.pending.get(msg.id);
        if (!entry || entry.acked) return;
        entry.acked = true;
        clearTimeout(entry.timer);
        const spec = COMMANDS[entry.cmd];
        entry.timer = setTimeout(() => this.timeout(msg.id), spec.expectedDurationMs(entry.args) + this.opts.doneMarginMs);
        return;
      }
      case 'done':
        if (!this.pending.has(msg.id)) {
          this.traffic.emit({ direction: 'warn', text: `Respuesta inesperada (id ${msg.id})` });
          return;
        }
        this.settle(msg.id, msg.result);
        return;
      case 'err':
        if (msg.id !== null && this.pending.has(msg.id)) {
          this.settle(msg.id, new RobotError(msg.code, msg.msg));
        } else {
          this.traffic.emit({ direction: 'warn', text: `El robot informó un error: ${msg.code}` });
        }
        return;
    }
  }

  private settle(id: number, outcome: Result | RobotError): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (outcome instanceof RobotError) entry.reject(outcome);
    else entry.resolve(outcome);
  }

  private timeout(id: number): void {
    this.settle(id, new RobotError('TIMEOUT'));
  }

  private checkLink(): void {
    if (Date.now() - this.lastRxAt > this.opts.linkTimeoutMs) {
      this.fail('El robot dejó de responder.');
      void this.transport.close().catch(() => undefined);
    }
  }

  private fail(reason: string): void {
    if (!this.connected) return;
    this.teardown(new RobotError('LINK_LOST'));
    this.linkLost.emit(reason);
  }

  private teardown(error: RobotError): void {
    this.connected = false;
    if (this.watchdog) clearInterval(this.watchdog);
    if (this.pinger) clearInterval(this.pinger);
    this.watchdog = null;
    this.pinger = null;
    for (const id of [...this.pending.keys()]) this.settle(id, error);
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
  }
}
