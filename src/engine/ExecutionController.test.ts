import { afterEach, describe, expect, it } from 'vitest';
import { compileWorkspace, type SerializedBlock } from '../blocks/compiler';
import { buildExampleProgram } from '../program/examples';
import type { Program } from '../program/ir';
import type { RobotSession } from '../robot/RobotSession';
import { connectedSession, delay, waitFor } from '../test/helpers';
import { ExecutionController } from './ExecutionController';

const sessions: RobotSession[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.disconnect();
});

async function setup(options: Parameters<typeof connectedSession>[0] = {}) {
  const ctx = await connectedSession(options);
  sessions.push(ctx.session);
  const controller = new ExecutionController(ctx.session, { loopDelayMs: 1 });
  return { ...ctx, controller };
}

function compileFor(session: RobotSession, ...steps: SerializedBlock[]): Program {
  const chain = steps.reduceRight<SerializedBlock | undefined>((next, b) => (next ? { ...b, next: { block: next } } : b), undefined);
  const result = compileWorkspace(
    { blocks: { blocks: [{ type: 'robot_on_start', id: 'start', ...(chain ? { next: { block: chain } } : {}) }] } },
    session.getSnapshot().capabilities,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.program;
}

describe('ejecución completa con el robot simulado', () => {
  it('ejecuta el programa de ejemplo de principio a fin', async () => {
    const { session, robot, controller } = await setup();
    const caps = session.getSnapshot().capabilities;
    const result = compileWorkspace(buildExampleProgram(caps), caps);
    if (!result.ok) throw new Error('no compila');
    expect(await controller.run(result.program)).toEqual({ status: 'finished' });
    expect(robot.snapshot().display).toBe('Hola');
    const commands = controller.getSnapshot().log.filter((e) => e.event.level === 'command').map((e) => e.event.text);
    expect(commands).toEqual([
      'DISPLAY_TEXT(text="Hola")',
      ...Array(3).fill(['MOVE_FORWARD(speed=50, duration_ms=1000)', 'TURN_RIGHT(speed=50, duration_ms=500)']).flat(),
    ]);
  });

  it('el estado de los módulos refleja lo que informa el robot', async () => {
    const { session, robot } = await setup({ modules: { sensors: 'absent', interface: 'error' } });
    expect(session.getSnapshot().modules.base.status).toBe('detected');
    expect(session.getSnapshot().modules.sensors.status).toBe('disconnected');
    expect(session.getSnapshot().modules.interface.status).toBe('error');
    robot.setModuleState('sensors', 'present');
    await waitFor(() => session.getSnapshot().modules.sensors.status === 'detected');
    expect(session.getSnapshot().capabilities.has('distance')).toBe(true);
  });

  it('si se desconecta un módulo en uso, detiene el programa y envía STOP', async () => {
    const { session, robot, controller } = await setup();
    const program = compileFor(session, {
      type: 'robot_forever',
      id: 'loop',
      inputs: {
        DO: {
          block: {
            type: 'robot_move_forward',
            id: 'mv',
            fields: { SECONDS: 0.5 },
            next: { block: { type: 'robot_led_toggle', id: 'led', fields: { LED: '1' } } },
          },
        },
      },
    });
    const run = controller.run(program);
    await delay(30);
    robot.setModuleState('sensors', 'absent');
    const outcome = await run;
    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('Módulo 2') });
    expect(robot.snapshot().motion).toBe('stopped');
    expect(session.getSnapshot().modules.sensors.status).toBe('disconnected');
    expect(controller.getSnapshot().state).toBe('idle');
  });

  it('un módulo que el programa no usa puede desconectarse sin pararlo', async () => {
    const { session, robot, controller } = await setup();
    const program = compileFor(session, { type: 'robot_move_forward', id: 'mv', fields: { SECONDS: 3 } });
    const run = controller.run(program);
    await delay(5);
    robot.setModuleState('interface', 'absent');
    expect(await run).toEqual({ status: 'finished' });
  });

  it('el botón Detener para el programa y el robot', async () => {
    const { session, robot, controller } = await setup({ timeScale: 1 });
    const program = compileFor(session, { type: 'robot_move_forward', id: 'mv', fields: { SECONDS: 10 } });
    const run = controller.run(program);
    await waitFor(() => robot.snapshot().motion === 'forward');
    await controller.stop();
    expect(await run).toEqual({ status: 'stopped' });
    await waitFor(() => robot.snapshot().motion === 'stopped', 500);
  });

  it('la pérdida de comunicación detiene el programa y deja los módulos como desconocidos', async () => {
    const { session, robot, controller } = await setup();
    const program = compileFor(session, { type: 'robot_wait', id: 'w', fields: { SECONDS: 30 } });
    const run = controller.run(program);
    robot.setResponsive(false);
    expect(await run).toMatchObject({ status: 'error', message: expect.stringContaining('comunicación') });
    const snap = session.getSnapshot();
    expect(snap.link).toBe('lost');
    expect(snap.modules.base.status).toBe('unknown');
    expect(snap.capabilities.size).toBe(0);
  });

  it('el cable desenchufado se refleja en la sesión', async () => {
    const { session, transport } = await setup();
    transport.unplug();
    await waitFor(() => session.getSnapshot().link === 'lost');
    expect(session.getSnapshot().notice).toMatch(/cable/);
  });
});
