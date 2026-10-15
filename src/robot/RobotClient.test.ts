import { afterEach, describe, expect, it } from 'vitest';
import { RobotClient } from './RobotClient';
import { RobotError } from './errors';
import { FAST_CLIENT, ScriptedTransport, delay, fastSimulator, helloReply } from '../test/helpers';

const clients: RobotClient[] = [];
const track = (c: RobotClient): RobotClient => {
  clients.push(c);
  return c;
};
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect();
});

describe('RobotClient con el simulador', () => {
  it('saluda, comprueba la versión y recibe los módulos', async () => {
    const { transport } = fastSimulator({ modules: { sensors: 'absent' } });
    const client = track(new RobotClient(transport, FAST_CLIENT));
    const hello = await client.connect();
    expect(hello.protocol).toBe('1.0');
    expect(hello.modules.map((m) => [m.type, m.state])).toEqual([
      ['base', 'ok'],
      ['sensors', 'absent'],
      ['interface', 'ok'],
    ]);
  });

  it('espera ack y done antes de dar una orden por terminada', async () => {
    const { robot, transport } = fastSimulator();
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    const pending = client.request('MOVE_FORWARD', { speed: 40, duration_ms: 1000 });
    await delay(3);
    expect(robot.snapshot().motion).toBe('forward');
    await pending;
    expect(robot.snapshot().motion).toBe('stopped');
  });

  it('valida los parámetros antes de enviarlos', async () => {
    const { transport } = fastSimulator();
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    await expect(client.request('SET_SERVO', { servo: 'shoulder_left', angle: 500 })).rejects.toMatchObject({ code: 'INVALID_ARGS' });
  });

  it('recibe el error del robot si el módulo no está', async () => {
    const { transport } = fastSimulator({ modules: { interface: 'absent' } });
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    await expect(client.request('DISPLAY_TEXT', { text: 'hola' })).rejects.toMatchObject({ code: 'MODULE_UNAVAILABLE' });
  });

  it('STOP aborta la orden en curso', async () => {
    const { robot, transport } = fastSimulator({ timeScale: 1 });
    const client = track(new RobotClient(transport, { ...FAST_CLIENT, doneMarginMs: 2000 }));
    await client.connect();
    const move = expect(client.request('MOVE_FORWARD', { speed: 50, duration_ms: 5000 })).rejects.toMatchObject({ code: 'ABORTED' });
    await delay(20);
    await client.request('STOP', {});
    await move;
    expect(robot.snapshot().motion).toBe('stopped');
  });

  it('notifica cambios de módulos en tiempo real', async () => {
    const { robot, transport } = fastSimulator();
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    const updates: string[] = [];
    client.onModules((mods) => updates.push(mods.find((m) => m.type === 'sensors')?.state ?? '?'));
    robot.setModuleState('sensors', 'error');
    await delay(10);
    expect(updates).toEqual(['error']);
  });

  it('detecta la pérdida de comunicación (robot que deja de responder)', async () => {
    const { robot, transport } = fastSimulator();
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    const lost = new Promise<string>((resolve) => client.onLinkLost(resolve));
    const pending = client.request('MOVE_FORWARD', { speed: 50, duration_ms: 30000 });
    robot.setResponsive(false);
    await expect(pending).rejects.toBeInstanceOf(RobotError);
    expect(await lost).toMatch(/dejó de responder/);
    expect(client.isConnected).toBe(false);
  });

  it('detecta el cable desconectado', async () => {
    const { transport } = fastSimulator();
    const client = track(new RobotClient(transport, FAST_CLIENT));
    await client.connect();
    const lost = new Promise<string>((resolve) => client.onLinkLost(resolve));
    transport.unplug();
    expect(await lost).toMatch(/cable/);
    await expect(client.request('PING', {})).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });
});

describe('RobotClient con respuestas incorrectas', () => {
  it('rechaza un robot con una versión mayor distinta del protocolo', async () => {
    const t = new ScriptedTransport((req) => [helloReply(req['id'], '2.0')]);
    const client = new RobotClient(t, FAST_CLIENT);
    await expect(client.connect()).rejects.toMatchObject({ code: 'INCOMPATIBLE' });
    expect(client.isConnected).toBe(false);
  });

  it('acepta un robot con otra versión menor', async () => {
    const t = new ScriptedTransport((req) => (req['cmd'] === 'HELLO' ? [helloReply(req['id'], '1.3')] : []));
    const client = track(new RobotClient(t, { ...FAST_CLIENT, pingIntervalMs: 10_000, linkTimeoutMs: 10_000 }));
    await expect(client.connect()).resolves.toMatchObject({ protocol: '1.3' });
  });

  it('rechaza un saludo mal formado', async () => {
    const t = new ScriptedTransport((req) => [JSON.stringify({ v: 1, type: 'done', id: req['id'], result: { robot: 1 } })]);
    await expect(new RobotClient(t, FAST_CLIENT).connect()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('no da por buena una orden con respuesta ilegible: expira', async () => {
    const warnings: string[] = [];
    const t = new ScriptedTransport((req) => (req['cmd'] === 'HELLO' ? [helloReply(req['id'])] : req['cmd'] === 'PING' ? [JSON.stringify({ v: 1, type: 'done', id: req['id'] })] : ['{basura', '{"v":1,"type":"ok"}']));
    const client = track(new RobotClient(t, FAST_CLIENT));
    client.onTraffic((e) => e.direction === 'warn' && warnings.push(e.text));
    await client.connect();
    await expect(client.request('STOP_MOTORS', {})).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('expira si llega ack pero nunca done', async () => {
    const t = new ScriptedTransport((req) =>
      req['cmd'] === 'HELLO' ? [helloReply(req['id'])] : req['cmd'] === 'PING' ? [JSON.stringify({ v: 1, type: 'done', id: req['id'] })] : [JSON.stringify({ v: 1, type: 'ack', id: req['id'] })],
    );
    const client = track(new RobotClient(t, FAST_CLIENT));
    await client.connect();
    await expect(client.request('MOVE_FORWARD', { speed: 50, duration_ms: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('ignora respuestas con id desconocido', async () => {
    const t = new ScriptedTransport((req) => (req['cmd'] === 'HELLO' ? [helloReply(req['id'])] : []));
    const client = track(new RobotClient(t, { ...FAST_CLIENT, pingIntervalMs: 10_000, linkTimeoutMs: 10_000 }));
    const warnings: string[] = [];
    client.onTraffic((e) => e.direction === 'warn' && warnings.push(e.text));
    await client.connect();
    t.push(JSON.stringify({ v: 1, type: 'done', id: 999, result: {} }));
    await delay(5);
    expect(warnings).toEqual(['Respuesta inesperada (id 999)']);
  });
});
