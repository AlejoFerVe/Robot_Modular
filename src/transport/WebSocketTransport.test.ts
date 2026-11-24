import { describe, expect, it } from 'vitest';
import { wifiUrl } from './WebSocketTransport';

describe('dirección Wi‑Fi del robot', () => {
  it('usa el puerto 81 por defecto', () => {
    expect(wifiUrl('192.168.4.1')).toBe('ws://192.168.4.1:81/');
    expect(wifiUrl('  ')).toBe('ws://192.168.4.1:81/');
  });

  it('respeta un puerto o una URL completa', () => {
    expect(wifiUrl('10.0.0.5:9000')).toBe('ws://10.0.0.5:9000/');
    expect(wifiUrl('ws://robot.local:81/')).toBe('ws://robot.local:81/');
  });
});
