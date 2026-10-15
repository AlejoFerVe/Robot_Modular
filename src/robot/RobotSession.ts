import type { CommandName } from '../protocol/commands';
import type { Args, Capability, ModuleReport } from '../protocol/types';
import { Emitter, type Transport, type TransportKind, type Unsubscribe } from '../transport/Transport';
import { RobotError } from './errors';
import { availableCapabilities, deriveModuleViews, lostCapabilities, type ModuleViews } from './modules';
import { RobotClient, type Result, type RobotClientOptions, type TrafficEntry } from './RobotClient';

export type LinkState = 'disconnected' | 'connecting' | 'connected' | 'lost';

export interface RobotInfo {
  readonly name: string;
  readonly firmware: string;
  readonly protocol: string;
}

export interface SessionSnapshot {
  readonly link: LinkState;
  readonly transport: TransportKind | null;
  readonly robot: RobotInfo | null;
  readonly modules: ModuleViews;
  readonly capabilities: ReadonlySet<Capability>;
  /** Último aviso de conexión para mostrar al usuario. */
  readonly notice: string | null;
}

const NO_MODULES = deriveModuleViews(null);

const INITIAL: SessionSnapshot = {
  link: 'disconnected',
  transport: null,
  robot: null,
  modules: NO_MODULES,
  capabilities: new Set(),
  notice: null,
};

/**
 * Estado de la conexión con el robot y de sus módulos. Es la única fuente de
 * verdad para la interfaz: los módulos solo aparecen como detectados si el
 * robot lo ha confirmado.
 */
export class RobotSession {
  private snapshot: SessionSnapshot = INITIAL;
  private client: RobotClient | null = null;
  private clientSubs: Unsubscribe[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly capsLost = new Emitter<Capability[]>();
  private readonly linkLost = new Emitter<string>();
  private readonly traffic = new Emitter<TrafficEntry>();

  constructor(private readonly clientOptions: RobotClientOptions = {}) {}

  // ─── Suscripción (compatible con useSyncExternalStore) ──────────────────

  subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  private set(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  onCapabilitiesLost(listener: (caps: Capability[]) => void): Unsubscribe {
    return this.capsLost.on(listener);
  }

  onLinkLost(listener: (reason: string) => void): Unsubscribe {
    return this.linkLost.on(listener);
  }

  onTraffic(listener: (entry: TrafficEntry) => void): Unsubscribe {
    return this.traffic.on(listener);
  }

  // ─── Conexión ─────────────────────────────────────────────────────────

  async connect(transport: Transport): Promise<void> {
    if (this.client) await this.disconnect();
    const client = new RobotClient(transport, this.clientOptions);
    this.client = client;
    this.set({ link: 'connecting', transport: transport.kind, robot: null, modules: NO_MODULES, capabilities: new Set(), notice: null });

    this.clientSubs = [
      client.onModules((modules) => this.applyModules(modules)),
      client.onLinkLost((reason) => this.handleLinkLost(client, reason)),
      client.onTraffic((entry) => this.traffic.emit(entry)),
    ];

    try {
      const hello = await client.connect();
      if (this.client !== client) return;
      this.set({ link: 'connected', robot: { name: hello.robot, firmware: hello.firmware, protocol: hello.protocol } });
      this.applyModules(hello.modules);
    } catch (error) {
      if (this.client === client) {
        this.release();
        const notice = error instanceof RobotError ? error.message : connectErrorMessage(error);
        this.set({ ...INITIAL, notice });
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.release();
    this.set({ ...INITIAL });
    await client.disconnect().catch(() => undefined);
  }

  /** Vuelve a pedir la lista de módulos al robot. */
  async refreshModules(): Promise<void> {
    if (!this.client) throw new RobotError('NOT_CONNECTED');
    this.applyModules(await this.client.getModules());
  }

  private release(): void {
    for (const unsubscribe of this.clientSubs) unsubscribe();
    this.clientSubs = [];
    this.client = null;
  }

  private handleLinkLost(client: RobotClient, reason: string): void {
    if (this.client !== client) return;
    const before = this.snapshot.capabilities;
    this.release();
    this.set({ ...INITIAL, link: 'lost', transport: this.snapshot.transport, notice: `${reason} Vuelve a conectar el robot.` });
    this.linkLost.emit(reason);
    if (before.size > 0) this.capsLost.emit([...before]);
  }

  private applyModules(reports: readonly ModuleReport[]): void {
    const modules = deriveModuleViews(reports);
    const capabilities = availableCapabilities(modules);
    const lost = lostCapabilities(this.snapshot.capabilities, capabilities);
    this.set({ modules, capabilities });
    if (lost.length > 0) this.capsLost.emit(lost);
  }

  // ─── ExecutionHost ────────────────────────────────────────────────────

  request(cmd: CommandName, args: Args): Promise<Result> {
    if (!this.client || this.snapshot.link !== 'connected') return Promise.reject(new RobotError('NOT_CONNECTED'));
    return this.client.request(cmd, args);
  }

  hasCapability(cap: Capability): boolean {
    return this.snapshot.link === 'connected' && this.snapshot.capabilities.has(cap);
  }
}

function connectErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No se eligió ningún puerto USB.';
  if (error instanceof Error && error.message) return `No se pudo conectar: ${error.message}`;
  return 'No se pudo conectar con el robot.';
}
