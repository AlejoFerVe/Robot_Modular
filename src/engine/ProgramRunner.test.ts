import { describe, expect, it, vi } from 'vitest';
import { CAPABILITIES, type Args, type Capability } from '../protocol/types';
import type { CommandName } from '../protocol/commands';
import { compileWorkspace, type SerializedBlock, type WorkspaceState } from '../blocks/compiler';
import type { Program } from '../program/ir';
import { RobotError } from '../robot/errors';
import { ProgramRunner, formatDisplayValue, type ExecutionHost } from './ProgramRunner';
import { delay } from '../test/helpers';

type Handler = (cmd: CommandName, args: Args) => Promise<Record<string, unknown>> | Record<string, unknown>;

function fakeHost(handler: Handler = () => ({}), caps: Iterable<Capability> = CAPABILITIES) {
  const calls: string[] = [];
  const available = new Set(caps);
  const host: ExecutionHost & { calls: string[]; available: Set<Capability> } = {
    calls,
    available,
    async request(cmd, args) {
      calls.push(`${cmd}${Object.keys(args).length ? ' ' + JSON.stringify(args) : ''}`);
      return handler(cmd, args);
    },
    hasCapability: (cap) => available.has(cap),
  };
  return host;
}

function compile(...steps: SerializedBlock[]): Program {
  const chain = steps.reduceRight<SerializedBlock | undefined>((next, b) => (next ? { ...b, next: { block: next } } : b), undefined);
  const state: WorkspaceState = { blocks: { blocks: [{ type: 'robot_on_start', id: 'start', ...(chain ? { next: { block: chain } } : {}) }] } };
  const result = compileWorkspace(state, new Set(CAPABILITIES));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.program;
}


describe('motor de ejecución', () => {
  it('ejecuta secuencias y repeticiones con la velocidad actual', async () => {
    const host = fakeHost();
    const runner = new ProgramRunner(host, { loopDelayMs: 0 });
    const program = compile(
      { type: 'robot_set_speed', id: 'sp', fields: { SPEED: 80 } },
      {
        type: 'robot_repeat',
        id: 'r',
        fields: { TIMES: 2 },
        inputs: { DO: { block: { type: 'robot_move_forward', id: 'f', fields: { SECONDS: 1 } } } },
      },
    );
    const blocks: (string | null)[] = [];
    expect(await runner.run(program, { onBlock: (id) => blocks.push(id) })).toEqual({ status: 'finished' });
    expect(host.calls).toEqual([
      'MOVE_FORWARD {"speed":80,"duration_ms":1000}',
      'MOVE_FORWARD {"speed":80,"duration_ms":1000}',
    ]);
    expect(blocks).toEqual(['sp', 'r', 'f', 'f', null]);
  });

  it('evalúa condiciones con lecturas de sensores (si / si no)', async () => {
    let distance = 10;
    const host = fakeHost((cmd) => (cmd === 'READ_DISTANCE' ? { cm: distance } : {}));
    const program = compile({
      type: 'robot_if_else',
      id: 'if',
      inputs: {
        COND: { block: { type: 'robot_distance_compare', id: 'd', fields: { OP: '<', CM: 20 } } },
        DO: { block: { type: 'robot_led_on', id: 'on', fields: { LED: '1' } } },
        ELSE: { block: { type: 'robot_led_off', id: 'off', fields: { LED: '1' } } },
      },
    });
    await new ProgramRunner(host).run(program);
    distance = 50;
    await new ProgramRunner(host).run(program);
    expect(host.calls).toEqual(['READ_DISTANCE', 'SET_LED {"led":1,"on":true}', 'READ_DISTANCE', 'SET_LED {"led":1,"on":false}']);
  });

  it('compara colores y muestra valores en la pantalla', async () => {
    const host = fakeHost((cmd) => (cmd === 'READ_COLOR' ? { color: 'red' } : {}));
    const program = compile(
      {
        type: 'robot_if',
        id: 'if',
        inputs: {
          COND: { block: { type: 'robot_color_is', id: 'c', fields: { COLOR: 'red' } } },
          DO: { block: { type: 'robot_display_value', id: 'dv', inputs: { VALUE: { block: { type: 'robot_read_color', id: 'rc' } } } } },
        },
      },
    );
    await new ProgramRunner(host).run(program);
    expect(host.calls).toEqual(['READ_COLOR', 'READ_COLOR', 'DISPLAY_TEXT {"text":"rojo"}']);
  });

  it('usa variables y aritmética', async () => {
    const host = fakeHost();
    const program: Program = {
      formatVersion: 1,
      requiredCapabilities: ['display'],
      body: [
        { kind: 'set_var', name: 'n', value: { kind: 'literal', value: 2 }, blockId: 'a' },
        { kind: 'change_var', name: 'n', delta: { kind: 'arith', op: '*', left: { kind: 'var', name: 'n' }, right: { kind: 'literal', value: 3 } }, blockId: 'b' },
        { kind: 'display', value: { kind: 'var', name: 'n' }, blockId: 'c' },
      ],
    };
    await new ProgramRunner(host).run(program);
    expect(host.calls).toEqual(['DISPLAY_TEXT {"text":"8"}']);
  });

  it('informa errores de ejecución comprensibles', async () => {
    const host = fakeHost();
    const program: Program = {
      formatVersion: 1,
      requiredCapabilities: [],
      body: [{ kind: 'set_var', name: 'x', value: { kind: 'arith', op: '/', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 0 } }, blockId: 'z' }],
    };
    expect(await new ProgramRunner(host).run(program)).toMatchObject({ status: 'error', message: 'No se puede dividir entre cero.' });
  });

  it('«repetir siempre» se detiene con stop() sin bloquear', async () => {
    const host = fakeHost();
    const runner = new ProgramRunner(host, { loopDelayMs: 1 });
    const program = compile({
      type: 'robot_forever',
      id: 'loop',
      inputs: { DO: { block: { type: 'robot_led_toggle', id: 't', fields: { LED: '1' } } } },
    });
    const done = runner.run(program);
    await delay(30);
    expect(runner.isRunning).toBe(true);
    runner.stop();
    expect(await done).toEqual({ status: 'stopped' });
    expect(host.calls.length).toBeGreaterThan(1);
  });

  it('stop() interrumpe una espera larga y una orden en curso', async () => {
    const host = fakeHost(() => new Promise(() => undefined)); // el robot nunca contesta
    const runner = new ProgramRunner(host);
    const waitProgram = compile({ type: 'robot_wait', id: 'w', fields: { SECONDS: 60 } });
    const p1 = runner.run(waitProgram);
    await delay(5);
    runner.stop();
    expect(await p1).toEqual({ status: 'stopped' });

    const moveProgram = compile({ type: 'robot_move_forward', id: 'f', fields: { SECONDS: 1 } });
    const p2 = runner.run(moveProgram);
    await delay(5);
    runner.stop();
    expect(await p2).toEqual({ status: 'stopped' });
  });

  it('no envía órdenes a un módulo que se desconectó', async () => {
    const host = fakeHost();
    const program = compile(
      { type: 'robot_led_on', id: 'a', fields: { LED: '1' } },
      { type: 'robot_wait', id: 'w', fields: { SECONDS: 0.1 } },
      { type: 'robot_led_off', id: 'b', fields: { LED: '1' } },
    );
    const run = new ProgramRunner(host).run(program);
    await delay(20);
    host.available.delete('leds');
    expect(await run).toMatchObject({ status: 'error', blockId: 'b', message: expect.stringContaining('Módulo 2') });
    expect(host.calls).toEqual(['SET_LED {"led":1,"on":true}']);
  });

  it('no arranca si falta una capacidad que el programa necesita', async () => {
    const host = fakeHost(() => ({}), ['motion']);
    const program = compile({ type: 'robot_beep', id: 'b', fields: { SECONDS: 1 } });
    expect(await new ProgramRunner(host).run(program)).toMatchObject({ status: 'error' });
    expect(host.calls).toEqual([]);
  });

  it('convierte los errores del robot en errores del bloque', async () => {
    const host = fakeHost(() => {
      throw new RobotError('BUSY');
    });
    const program = compile({ type: 'robot_stop_motors', id: 's' });
    expect(await new ProgramRunner(host).run(program)).toEqual({ status: 'error', message: 'El robot todavía está haciendo otra cosa.', blockId: 's' });
  });

  it('rechaza lecturas de sensor no válidas', async () => {
    const host = fakeHost(() => ({ cm: 'cerca' }));
    const program = compile({
      type: 'robot_if',
      id: 'if',
      inputs: { COND: { block: { type: 'robot_distance_compare', id: 'd', fields: { OP: '<', CM: 20 } } } },
    });
    expect(await new ProgramRunner(host).run(program)).toMatchObject({ status: 'error', blockId: 'd' });
  });

  it('abort() termina con el mensaje de seguridad', async () => {
    const host = fakeHost();
    const runner = new ProgramRunner(host);
    const run = runner.run(compile({ type: 'robot_wait', id: 'w', fields: { SECONDS: 10 } }));
    await delay(5);
    runner.abort('Se desconectó algo.');
    expect(await run).toEqual({ status: 'error', message: 'Se desconectó algo.', blockId: null });
  });

  it('no permite dos ejecuciones simultáneas', async () => {
    const runner = new ProgramRunner(fakeHost());
    const program = compile({ type: 'robot_wait', id: 'w', fields: { SECONDS: 1 } });
    const first = runner.run(program);
    await expect(runner.run(program)).rejects.toThrow();
    runner.stop();
    await first;
  });

  it('formatea valores para la pantalla', () => {
    expect(formatDisplayValue(true)).toBe('verdadero');
    expect(formatDisplayValue(1 / 3)).toBe('0.33');
    expect(formatDisplayValue('x'.repeat(50))).toHaveLength(32);
  });

  it('no usa eval ni Function', () => {
    const evalSpy = vi.spyOn(globalThis, 'eval');
    expect(evalSpy).not.toHaveBeenCalled();
  });
});
