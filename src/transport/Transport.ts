/**
 * Capa de transporte entre la aplicación y el ESP32 del Módulo 1.
 * Solo mueve texto; no sabe nada del protocolo ni de los bloques.
 * Implementaciones: USB serie (Web Serial), Wi‑Fi (WebSocket) y simulador.
 */
export type TransportKind = 'serial' | 'wifi' | 'simulator';

export type Unsubscribe = () => void;

export interface Transport {
  readonly kind: TransportKind;
  /** Nombre visible para el usuario. */
  readonly label: string;
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: string): Promise<void>;
  onData(listener: (chunk: string) => void): Unsubscribe;
  /** Se llama una sola vez si el enlace se cierra (cable desconectado, error, close()). */
  onClose(listener: (reason: string) => void): Unsubscribe;
}

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
