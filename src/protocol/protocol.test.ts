import { describe, expect, it } from 'vitest';
import { LineBuffer, MAX_LINE_LENGTH, decodeLine, encodeRequest, isProtocolCompatible, parseModuleReport } from './codec';
import { formatInstruction, validateArgs } from './commands';

describe('codec', () => {
  it('codifica una petición como una línea JSON', () => {
    const line = encodeRequest(7, 'MOVE_FORWARD', { speed: 50, duration_ms: 2000 });
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual({ v: 1, type: 'req', id: 7, cmd: 'MOVE_FORWARD', args: { speed: 50, duration_ms: 2000 } });
  });

  it('decodifica ack, done, err y eventos válidos', () => {
    expect(decodeLine('{"v":1,"type":"ack","id":3}')).toEqual({ ok: true, message: { v: 1, type: 'ack', id: 3 } });
    expect(decodeLine('{"v":1,"type":"done","id":3,"result":{"cm":12}}')).toMatchObject({ ok: true, message: { result: { cm: 12 } } });
    expect(decodeLine('{"v":1,"type":"err","id":3,"code":"BUSY","msg":"x"}')).toMatchObject({ ok: true, message: { code: 'BUSY' } });
    expect(decodeLine('{"v":1,"type":"evt","evt":"status","busy":false,"uptime_ms":10}').ok).toBe(true);
  });

  it.each([
    ['texto no JSON', 'hola robot'],
    ['sin versión', '{"type":"ack","id":1}'],
    ['ack sin id', '{"v":1,"type":"ack"}'],
    ['id negativo', '{"v":1,"type":"ack","id":-1}'],
    ['código de error desconocido', '{"v":1,"type":"err","id":1,"code":"OOPS"}'],
    ['tipo desconocido', '{"v":1,"type":"magic","id":1}'],
    ['done con resultado no objeto', '{"v":1,"type":"done","id":1,"result":5}'],
    ['módulos mal formados', '{"v":1,"type":"evt","evt":"modules","modules":[{"type":"x"}]}'],
  ])('rechaza respuestas incorrectas: %s', (_name, line) => {
    expect(decodeLine(line).ok).toBe(false);
  });

  it('rechaza mensajes de otra versión mayor del protocolo', () => {
    expect(decodeLine('{"v":2,"type":"ack","id":1}')).toEqual({ ok: false, reason: 'versión de protocolo 2 no compatible' });
  });

  it('comprueba la compatibilidad de versiones (misma mayor)', () => {
    expect(isProtocolCompatible('1.0')).toBe(true);
    expect(isProtocolCompatible('1.7')).toBe(true);
    expect(isProtocolCompatible('2.0')).toBe(false);
    expect(isProtocolCompatible('0.9')).toBe(false);
    expect(isProtocolCompatible('uno')).toBe(false);
  });

  it('descarta capacidades desconocidas y vacía las de módulos no operativos', () => {
    expect(
      parseModuleReport({ type: 'sensors', typeId: 2, firmware: '1.0.0', capabilities: ['distance', 'laser'], state: 'ok' })?.capabilities,
    ).toEqual(['distance']);
    expect(
      parseModuleReport({ type: 'sensors', typeId: 2, firmware: '1.0.0', capabilities: ['distance'], state: 'error' })?.capabilities,
    ).toEqual([]);
  });

  it('separa el flujo en líneas aunque lleguen trozos', () => {
    const buf = new LineBuffer();
    expect(buf.push('{"a":')).toEqual([]);
    expect(buf.push('1}\r\n{"b"')).toEqual(['{"a":1}']);
    expect(buf.push(':2}\n\n')).toEqual(['{"b":2}']);
  });

  it('descarta líneas demasiado largas sin bloquearse', () => {
    const buf = new LineBuffer();
    buf.push('x'.repeat(MAX_LINE_LENGTH + 10));
    expect(buf.push('resto\n{"ok":1}\n')).toEqual(['{"ok":1}']);
  });
});

describe('validación de parámetros', () => {
  it('acepta parámetros válidos', () => {
    expect(validateArgs('MOVE_FORWARD', { speed: 50, duration_ms: 2000 })).toEqual([]);
    expect(validateArgs('SET_LED', { led: 0, on: true })).toEqual([]);
  });

  it('detecta valores fuera de rango, de tipo incorrecto, ausentes o desconocidos', () => {
    expect(validateArgs('MOVE_FORWARD', { speed: 150, duration_ms: 2000 })[0]?.arg).toBe('speed');
    expect(validateArgs('MOVE_FORWARD', { speed: 50.5, duration_ms: 2000 })[0]?.reason).toMatch(/entero/);
    expect(validateArgs('MOVE_FORWARD', { speed: 50 })[0]).toEqual({ arg: 'duration_ms', reason: 'falta el valor' });
    expect(validateArgs('SET_SERVO', { servo: 'nariz', angle: 10 })[0]?.arg).toBe('servo');
    expect(validateArgs('DISPLAY_TEXT', { text: 'x'.repeat(40) })[0]?.reason).toMatch(/máximo/);
    expect(validateArgs('PING', { extra: 1 })[0]?.reason).toBe('parámetro desconocido');
  });

  it('formatea instrucciones legibles', () => {
    expect(formatInstruction('MOVE_FORWARD', { speed: 50, duration_ms: 2000 })).toBe('MOVE_FORWARD(speed=50, duration_ms=2000)');
  });
});
