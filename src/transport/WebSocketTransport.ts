import { Emitter, type Transport, type Unsubscribe } from './Transport';

/**
 * IP fija del ESP32 del Módulo 1 en su propia red Wi‑Fi (modo punto de acceso).
 * Debe coincidir con IP_ROBOT en firmware/modulo1_wifi/modulo1_wifi.ino.
 */
export const DEFAULT_WIFI_HOST = '192.168.4.1';
export const WIFI_PORT = 81;
const OPEN_TIMEOUT_MS = 5000;

/** Acepta "192.168.4.1", "192.168.4.1:81" o "ws://192.168.4.1:81/". */
export function wifiUrl(host: string): string {
  const clean = host.trim() || DEFAULT_WIFI_HOST;
  if (/^wss?:\/\//i.test(clean)) return clean;
  return /:\d+$/.test(clean) ? `ws://${clean}/` : `ws://${clean}:${WIFI_PORT}/`;
}

/**
 * Transporte Wi‑Fi: WebSocket con el ESP32 del Módulo 1.
 * Mismo formato que por USB (un objeto JSON por línea); cada mensaje del
 * robot llega como un mensaje de texto del WebSocket.
 */
export class WebSocketTransport implements Transport {
  readonly kind = 'wifi' as const;
  readonly label = 'Wi‑Fi';
  private socket: WebSocket | null = null;
  private readonly data = new Emitter<string>();
  private readonly closed = new Emitter<string>();
  private isClosed = false;

  constructor(private readonly host: string = DEFAULT_WIFI_HOST) {}

  open(): Promise<void> {
    const url = wifiUrl(this.host);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error(`el robot no responde en ${url}. ¿Estás conectado a su red Wi‑Fi?`));
      }, OPEN_TIMEOUT_MS);

      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.socket = socket;
        this.isClosed = false;
        resolve();
      };
      socket.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        this.data.emit(event.data.endsWith('\n') ? event.data : event.data + '\n');
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`no se pudo abrir ${url}. ¿Estás conectado a la red Wi‑Fi del robot?`));
      };
      socket.onclose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`el robot cerró la conexión (${url}).`));
          return;
        }
        this.finish('Se perdió la conexión Wi‑Fi con el robot.');
      };
    });
  }

  write(data: string): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('La conexión Wi‑Fi no está abierta.'));
    socket.send(data);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.finish('Desconectado por el usuario.');
    return Promise.resolve();
  }

  private finish(reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close();
      } catch {
        // Ya estaba cerrado.
      }
    }
    this.closed.emit(reason);
  }

  onData(listener: (chunk: string) => void): Unsubscribe {
    return this.data.on(listener);
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    return this.closed.on(listener);
  }
}
