import { COMMANDS, isCommandName, validateArgs, type CommandName } from '../protocol/commands';
import { LineBuffer } from '../protocol/codec';
import {
  MODULE_CAPABILITIES,
  MODULE_TYPE_IDS,
  capabilityOwner,
  PROTOCOL_VERSION,
  type Args,
  type ColorName,
  type ErrorCode,
  type ModuleReport,
  type ModuleType,
  type ServoName,
} from '../protocol/types';
import { Emitter, type Unsubscribe } from '../transport/Transport';

/**
 * Robot virtual que habla el mismo protocolo que el firmware del Módulo 1.
 * Sirve para desarrollar y probar sin hardware. Sus lecturas son inventadas
 * y la interfaz siempre las marca como simuladas.
 */

export type SimModuleState = 'present' | 'absent' | 'error';

export interface SimulatorOptions {
  /** Multiplica todas las duraciones (1 = tiempo real; en pruebas se usa algo pequeño). */
  readonly timeScale?: number;
  readonly statusIntervalMs?: number;
  readonly modules?: Partial<Record<Exclude<ModuleType, 'base'>, SimModuleState>>;
}

export interface SimSnapshot {
  readonly modules: Readonly<Record<Exclude<ModuleType, 'base'>, SimModuleState>>;
  readonly motion: 'stopped' | 'forward' | 'backward' | 'left' | 'right';
  readonly speed: number;
  readonly servos: Readonly<Record<ServoName, number>>;
  readonly leds: readonly boolean[];
  readonly buzzer: boolean;
  readonly display: string;
  readonly distanceCm: number;
  readonly color: ColorName;
  readonly buttons: Readonly<Record<'A' | 'B', boolean>>;
  readonly responsive: boolean;
}

const MODULE_CAPS = MODULE_CAPABILITIES;

const SIM_FIRMWARE = '0.1.0-sim';
const WATCHDOG_MS = 2000;

const ownerOf = capabilityOwner;

export class SimulatedRobot {
  private readonly timeScale: number;
  private readonly statusIntervalMs: number;
  private readonly out = new Emitter<string>();
  private readonly changed = new Emitter<SimSnapshot>();
  private readonly input = new LineBuffer();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private lastRxAt = 0;
  private running: { id: number; module: ModuleType; timer: ReturnType<typeof setTimeout> } | null = null;
  private state: SimSnapshot;

  constructor(options: SimulatorOptions = {}) {
    this.timeScale = options.timeScale ?? 1;
    this.statusIntervalMs = options.statusIntervalMs ?? 1000;
    this.state = {
      modules: { sensors: options.modules?.sensors ?? 'present', interface: options.modules?.interface ?? 'present' },
      motion: 'stopped',
      speed: 0,
      servos: { shoulder_left: 90, shoulder_right: 90, gripper_left: 0, gripper_right: 0 },
      leds: [false, false, false, false],
      buzzer: false,
      display: '',
      distanceCm: 40,
      color: 'unknown',
      buttons: { A: false, B: false },
      responsive: true,
    };
  }

  // ─── Conexión ────────────────────────────────────────────────────────────

  start(): void {
    this.lastRxAt = Date.now();
    this.statusTimer = setInterval(() => this.tick(), this.statusIntervalMs);
  }

  stop(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.running = null;
  }

  onOutput(listener: (chunk: string) => void): Unsubscribe {
    return this.out.on(listener);
  }

  onChange(listener: (snapshot: SimSnapshot) => void): Unsubscribe {
    return this.changed.on(listener);
  }

  snapshot(): SimSnapshot {
    return this.state;
  }

  receive(chunk: string): void {
    if (!this.state.responsive) return;
    this.lastRxAt = Date.now();
    for (const line of this.input.push(chunk)) this.handleLine(line);
  }

  // ─── Controles del panel del simulador ──────────────────────────────────

  setModuleState(module: Exclude<ModuleType, 'base'>, value: SimModuleState): void {
    this.update({ modules: { ...this.state.modules, [module]: value } });
    if (this.running?.module === module && !this.moduleOk(module)) {
      // El firmware aborta un comando en curso dirigido a un módulo que desaparece.
      this.abortRunning('MODULE_UNAVAILABLE', 'El módulo dejó de responder');
    }
    this.send({ type: 'evt', evt: 'modules', modules: this.modules() });
  }

  /** Simula un robot que deja de responder (cuelgue o pérdida del enlace). */
  setResponsive(responsive: boolean): void {
    this.update({ responsive });
  }

  setDistance(distanceCm: number): void {
    this.update({ distanceCm: Math.max(0, Math.min(400, Math.round(distanceCm))) });
  }

  setColor(color: ColorName): void {
    this.update({ color });
  }

  setButton(button: 'A' | 'B', pressed: boolean): void {
    this.update({ buttons: { ...this.state.buttons, [button]: pressed } });
  }

  // ─── Lógica interna ─────────────────────────────────────────────────────

  private update(patch: Partial<SimSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.changed.emit(this.state);
  }

  private moduleOk(module: ModuleType): boolean {
    return module === 'base' || this.state.modules[module] === 'present';
  }

  private modules(): ModuleReport[] {
    return (Object.keys(MODULE_CAPS) as ModuleType[]).map((type) => {
      const sim: SimModuleState = type === 'base' ? 'present' : this.state.modules[type];
      if (sim === 'absent') return { type, typeId: MODULE_TYPE_IDS[type], firmware: '', capabilities: [], state: 'absent' };
      if (sim === 'error') {
        return { type, typeId: MODULE_TYPE_IDS[type], firmware: SIM_FIRMWARE, capabilities: [], state: 'error', error: 'I2C_ERROR' };
      }
      return { type, typeId: MODULE_TYPE_IDS[type], firmware: SIM_FIRMWARE, capabilities: [...MODULE_CAPS[type]], state: 'ok' };
    });
  }

  private tick(): void {
    if (!this.state.responsive) return;
    if (Date.now() - this.lastRxAt > WATCHDOG_MS && this.state.motion !== 'stopped') {
      // Vigilancia del firmware: sin noticias de la app, el robot se detiene.
      this.stopActuators();
    }
    this.send({ type: 'evt', evt: 'status', busy: this.running !== null, uptime_ms: Date.now() });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.state.responsive) return;
    const line = JSON.stringify({ v: PROTOCOL_VERSION.major, ...payload }) + '\n';
    this.later(() => this.out.emit(line), 2);
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms * this.timeScale);
    this.timers.add(timer);
    return timer;
  }

  private error(id: number | null, code: ErrorCode, msg: string): void {
    this.send({ type: 'err', id, code, msg });
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.error(null, 'BAD_REQUEST', 'JSON no válido');
      return;
    }
    if (typeof msg !== 'object' || msg === null) return this.error(null, 'BAD_REQUEST', 'no es un objeto');
    const { v, type, id, cmd, args } = msg as Record<string, unknown>;
    if (typeof id !== 'number') return this.error(null, 'BAD_REQUEST', 'falta id');
    if (v !== PROTOCOL_VERSION.major) return this.error(id, 'VERSION_MISMATCH', 'versión no soportada');
    if (type !== 'req' || typeof cmd !== 'string') return this.error(id, 'BAD_REQUEST', 'petición no válida');
    if (!isCommandName(cmd)) return this.error(id, 'UNKNOWN_COMMAND', cmd);
    const safeArgs = (typeof args === 'object' && args !== null ? args : {}) as Args;
    if (validateArgs(cmd, safeArgs).length > 0) return this.error(id, 'INVALID_ARGS', 'parámetros no válidos');
    this.execute(id, cmd, safeArgs);
  }

  private execute(id: number, cmd: CommandName, args: Args): void {
    const capability = COMMANDS[cmd].capability;
    if (capability && !this.moduleOk(ownerOf(capability))) {
      return this.error(id, 'MODULE_UNAVAILABLE', `el módulo ${ownerOf(capability)} no está disponible`);
    }

    switch (cmd) {
      case 'HELLO':
        return this.done(id, {
          protocol: `${PROTOCOL_VERSION.major}.${PROTOCOL_VERSION.minor}`,
          robot: 'robot-modular-sim',
          firmware: SIM_FIRMWARE,
          modules: this.modules(),
        });
      case 'PING':
        return this.done(id, {});
      case 'GET_MODULES':
        return this.done(id, { modules: this.modules() });
      case 'STOP':
        this.abortRunning('ABORTED', 'detenido');
        this.stopActuators();
        return this.done(id, {});
      case 'READ_COLOR':
        return this.done(id, { color: this.state.color });
      case 'READ_DISTANCE':
        return this.done(id, { cm: this.state.distanceCm });
      case 'READ_BUTTON':
        return this.done(id, { pressed: this.state.buttons[args['button'] === 'B' ? 'B' : 'A'] });
      default:
        return this.runActuator(id, cmd, args);
    }
  }

  private runActuator(id: number, cmd: CommandName, args: Args): void {
    if (this.running) return this.error(id, 'BUSY', 'el robot está ocupado');
    this.send({ type: 'ack', id });
    const num = (k: string): number => (typeof args[k] === 'number' ? args[k] : 0);

    switch (cmd) {
      case 'MOVE_FORWARD':
      case 'MOVE_BACKWARD':
      case 'TURN_LEFT':
      case 'TURN_RIGHT': {
        const motion = ({ MOVE_FORWARD: 'forward', MOVE_BACKWARD: 'backward', TURN_LEFT: 'left', TURN_RIGHT: 'right' } as const)[cmd];
        this.update({ motion, speed: num('speed') });
        break;
      }
      case 'STOP_MOTORS':
        this.update({ motion: 'stopped', speed: 0 });
        break;
      case 'SET_SERVO':
        this.update({ servos: { ...this.state.servos, [String(args['servo'])]: num('angle') } });
        break;
      case 'GRIPPER': {
        const servo = args['side'] === 'left' ? 'gripper_left' : 'gripper_right';
        this.update({ servos: { ...this.state.servos, [servo]: args['action'] === 'open' ? 60 : 0 } });
        break;
      }
      case 'SET_LED':
      case 'TOGGLE_LED': {
        const led = num('led');
        const leds = this.state.leds.map((on, i) => {
          if (led !== 0 && led !== i + 1) return on;
          return cmd === 'SET_LED' ? args['on'] === true : !on;
        });
        this.update({ leds });
        break;
      }
      case 'BEEP':
      case 'PLAY_TONE':
        this.update({ buzzer: true });
        break;
      case 'DISPLAY_TEXT':
        this.update({ display: String(args['text']) });
        break;
      case 'DISPLAY_CLEAR':
        this.update({ display: '' });
        break;
      default:
        break;
    }

    const duration = COMMANDS[cmd].expectedDurationMs(args);
    const timer = this.later(() => {
      this.running = null;
      if (cmd.startsWith('MOVE_') || cmd.startsWith('TURN_')) this.update({ motion: 'stopped', speed: 0 });
      if (cmd === 'BEEP' || cmd === 'PLAY_TONE') this.update({ buzzer: false });
      this.send({ type: 'done', id, result: {} });
    }, Math.max(5, duration));
    const capability = COMMANDS[cmd].capability;
    this.running = { id, module: capability ? ownerOf(capability) : 'base', timer };
  }

  private done(id: number, result: Record<string, unknown>): void {
    this.send({ type: 'ack', id });
    this.send({ type: 'done', id, result });
  }

  private abortRunning(code: ErrorCode, msg: string): void {
    if (!this.running) return;
    clearTimeout(this.running.timer);
    this.timers.delete(this.running.timer);
    this.error(this.running.id, code, msg);
    this.running = null;
  }

  private stopActuators(): void {
    this.update({ motion: 'stopped', speed: 0, buzzer: false });
  }
}
