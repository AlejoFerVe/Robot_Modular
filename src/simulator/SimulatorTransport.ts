import { Emitter, type Transport, type Unsubscribe } from '../transport/Transport';
import { SimulatedRobot } from './SimulatedRobot';

/** Transporte que conecta la aplicación con el robot virtual. */
export class SimulatorTransport implements Transport {
  readonly kind = 'simulator' as const;
  readonly label = 'Simulador';
  private readonly data = new Emitter<string>();
  private readonly closed = new Emitter<string>();
  private unsubscribe: Unsubscribe | null = null;
  private isOpen = false;

  constructor(readonly robot: SimulatedRobot) {}

  async open(): Promise<void> {
    this.unsubscribe = this.robot.onOutput((chunk) => {
      if (this.isOpen) this.data.emit(chunk);
    });
    this.isOpen = true;
    this.robot.start();
  }

  async write(data: string): Promise<void> {
    if (!this.isOpen) throw new Error('El simulador no está conectado.');
    this.robot.receive(data);
  }

  async close(): Promise<void> {
    this.shutdown('Desconectado por el usuario.');
  }

  /** Simula que se desconecta el cable. */
  unplug(): void {
    this.shutdown('El cable USB se desconectó.');
  }

  private shutdown(reason: string): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.unsubscribe?.();
    this.robot.stop();
    this.closed.emit(reason);
  }

  onData(listener: (chunk: string) => void): Unsubscribe {
    return this.data.on(listener);
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    return this.closed.on(listener);
  }
}
