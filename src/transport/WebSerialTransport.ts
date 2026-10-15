import { Emitter, type Transport, type Unsubscribe } from './Transport';

export const SERIAL_BAUD_RATE = 115200;

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Transporte USB serie mediante la Web Serial API (Chrome / Edge de escritorio).
 * El usuario elige el puerto en el diálogo del navegador.
 */
export class WebSerialTransport implements Transport {
  readonly kind = 'serial' as const;
  readonly label = 'USB';
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readLoopDone: Promise<void> | null = null;
  private readonly data = new Emitter<string>();
  private readonly closed = new Emitter<string>();
  private isClosed = false;

  async open(): Promise<void> {
    if (!isWebSerialSupported()) {
      throw new Error('Este navegador no permite conectar por USB. Usa Chrome o Edge.');
    }
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: SERIAL_BAUD_RATE });
    this.port = port;
    this.isClosed = false;
    navigator.serial.addEventListener('disconnect', this.handleDisconnect);
    this.readLoopDone = this.readLoop(port);
  }

  private handleDisconnect = (event: Event): void => {
    if (event.target === this.port) void this.finish('El cable USB se desconectó.');
  };

  private async readLoop(port: SerialPort): Promise<void> {
    if (!port.readable) return;
    const decoder = new TextDecoderStream();
    const pipeDone = port.readable.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => undefined);
    const reader = decoder.readable.getReader();
    this.reader = reader;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.data.emit(value);
      }
    } catch {
      // La lectura falla cuando el puerto se pierde; se informa abajo.
    } finally {
      reader.releaseLock();
      await pipeDone;
      void this.finish('Se perdió la conexión USB.');
    }
  }

  async write(data: string): Promise<void> {
    const writable = this.port?.writable;
    if (!writable) throw new Error('El puerto USB no está abierto.');
    const writer = writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(data));
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    await this.finish('Desconectado por el usuario.');
  }

  private async finish(reason: string): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    navigator.serial.removeEventListener('disconnect', this.handleDisconnect);
    try {
      await this.reader?.cancel();
      await this.readLoopDone;
      await this.port?.close();
    } catch {
      // El puerto puede haber desaparecido ya.
    }
    this.port = null;
    this.reader = null;
    this.closed.emit(reason);
  }

  onData(listener: (chunk: string) => void): Unsubscribe {
    return this.data.on(listener);
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    return this.closed.on(listener);
  }
}
