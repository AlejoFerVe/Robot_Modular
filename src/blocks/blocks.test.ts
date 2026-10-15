import { describe, expect, it } from 'vitest';
import { CAPABILITIES, MODULE_CAPABILITIES, type Capability } from '../protocol/types';
import { buildExampleProgram } from '../program/examples';
import { formatProgram } from '../program/ir';
import { compileWorkspace, type SerializedBlock, type WorkspaceState } from './compiler';
import { BLOCKS } from './definitions';
import { availableBlockTypes, buildToolbox } from './toolbox';

const caps = (...modules: (keyof typeof MODULE_CAPABILITIES)[]): Set<Capability> =>
  new Set(modules.flatMap((m) => MODULE_CAPABILITIES[m]));

const ALL = new Set(CAPABILITIES);

const program = (...steps: SerializedBlock[]): WorkspaceState => {
  const chain = steps.reduceRight<SerializedBlock | undefined>((next, b) => (next ? { ...b, next: { block: next } } : b), undefined);
  return { blocks: { blocks: [{ type: 'robot_on_start', id: 'start', ...(chain ? { next: { block: chain } } : {}) }] } };
};

describe('caja de herramientas según los módulos detectados', () => {
  const categories = (c: Set<Capability>) => buildToolbox(c).contents.map((cat) => cat.name);

  it('sin robot: solo control, comparaciones y variables', () => {
    expect(categories(new Set())).toEqual(['Control', 'Comparaciones', 'Variables']);
  });

  it('Módulo 1: movimiento, brazos y sensor de color', () => {
    const types = availableBlockTypes(caps('base'));
    expect(categories(caps('base'))).toEqual(['Control', 'Movimiento', 'Brazos', 'Sensores', 'Comparaciones', 'Variables']);
    expect(types).toContain('robot_color_is');
    expect(types).not.toContain('robot_read_distance');
    expect(types).not.toContain('robot_led_on');
    expect(types).not.toContain('robot_display_text');
  });

  it('Módulo 1 + 2: añade distancia, LED y buzzer', () => {
    const types = availableBlockTypes(caps('base', 'sensors'));
    expect(categories(caps('base', 'sensors'))).toContain('Luces y sonido');
    expect(types).toEqual(expect.arrayContaining(['robot_read_distance', 'robot_distance_compare', 'robot_led_on', 'robot_beep', 'robot_tone']));
    expect(types).not.toContain('robot_display_text');
  });

  it('Módulo 1 + 3: añade pantalla y botones', () => {
    const types = availableBlockTypes(caps('base', 'interface'));
    expect(categories(caps('base', 'interface'))).toContain('Pantalla y botones');
    expect(types).toEqual(expect.arrayContaining(['robot_display_text', 'robot_display_value', 'robot_button_pressed']));
    expect(types).not.toContain('robot_led_on');
  });

  it('los tres módulos: todos los bloques', () => {
    expect(availableBlockTypes(caps('base', 'sensors', 'interface'))).toHaveLength(BLOCKS.length);
  });

  it('las variantes de pinza aparecen como cuatro bloques', () => {
    const arms = buildToolbox(caps('base')).contents.find((c) => c.name === 'Brazos');
    expect(arms?.contents.filter((b) => b.kind === 'block' && b.type === 'robot_gripper')).toHaveLength(4);
  });
});

describe('compilador de bloques', () => {
  it('compila el programa de ejemplo completo', () => {
    const result = compileWorkspace(buildExampleProgram(ALL), ALL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatProgram(result.program)).toBe(
      [
        'ON_START',
        '  DISPLAY_TEXT(text="Hola")',
        '  REPEAT(3)',
        '    MOVE_FORWARD(speed=<velocidad>, duration_ms=1000)',
        '    TURN_RIGHT(speed=<velocidad>, duration_ms=500)',
      ].join('\n'),
    );
    expect([...result.program.requiredCapabilities].sort()).toEqual(['display', 'motion']);
  });

  it('el ejemplo sin Módulo 3 no usa la pantalla', () => {
    const state = buildExampleProgram(caps('base'));
    const result = compileWorkspace(state, caps('base'));
    expect(result.ok).toBe(true);
    expect(JSON.stringify(state)).not.toContain('robot_display_text');
  });

  it('exige un bloque «Al iniciar»', () => {
    const result = compileWorkspace({ blocks: { blocks: [{ type: 'robot_wait', id: 'w', fields: { SECONDS: 1 } }] } }, ALL);
    expect(result).toMatchObject({ ok: false, errors: [{ blockId: null }] });
  });

  it('marca los bloques de módulos no disponibles', () => {
    const result = compileWorkspace(program({ type: 'robot_led_on', id: 'led', fields: { LED: '1' } }), caps('base'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toEqual({ blockId: 'led', message: expect.stringContaining('Módulo 2') });
  });

  it('valida los parámetros', () => {
    const bad = compileWorkspace(program({ type: 'robot_move_forward', id: 'm', fields: { SECONDS: 99 } }), ALL);
    expect(bad).toMatchObject({ ok: false, errors: [{ blockId: 'm', message: expect.stringContaining('entre 0.1 y 30') }] });
    const longText = compileWorkspace(program({ type: 'robot_display_text', id: 't', fields: { TEXT: 'x'.repeat(40) } }), ALL);
    expect(longText.ok).toBe(false);
    const badServo = compileWorkspace(program({ type: 'robot_servo_angle', id: 's', fields: { SERVO: 'cola', ANGLE: 10 } }), ALL);
    expect(badServo.ok).toBe(false);
  });

  it('señala huecos vacíos', () => {
    const result = compileWorkspace(program({ type: 'robot_if', id: 'if' }), ALL);
    expect(result).toMatchObject({ ok: false, errors: [{ blockId: 'if', message: expect.stringContaining('falta un valor') }] });
  });

  it('avisa de bloques sueltos y los ignora', () => {
    const state: WorkspaceState = {
      blocks: { blocks: [{ type: 'robot_on_start', id: 's' }, { type: 'robot_wait', id: 'loose', fields: { SECONDS: 1 } }] },
    };
    const result = compileWorkspace(state, ALL);
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.blockId)).toContain('loose');
  });

  it('compila condiciones, variables y sensores', () => {
    const state: WorkspaceState = {
      variables: [{ id: 'v1', name: 'vueltas' }],
      ...program(
        { type: 'robot_var_set', id: 'set', fields: { VAR: { id: 'v1' } }, inputs: { VALUE: { shadow: { type: 'robot_number', fields: { NUM: 0 } } } } },
        {
          type: 'robot_if_else',
          id: 'if',
          inputs: {
            COND: { block: { type: 'robot_distance_compare', id: 'd', fields: { OP: '<', CM: 20 } } },
            DO: { block: { type: 'robot_led_on', id: 'on', fields: { LED: '0' } } },
            ELSE: { block: { type: 'robot_var_change', id: 'chg', fields: { VAR: { id: 'v1' } }, inputs: { DELTA: { shadow: { type: 'robot_number', fields: { NUM: 1 } } } } } },
          },
        },
      ),
    };
    const result = compileWorkspace(state, ALL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(formatProgram(result.program)).toBe(
      ['ON_START', '  vueltas = 0', '  IF (READ_DISTANCE() < 20)', '    SET_LED(led=0, on=true)', '  ELSE', '    vueltas += 1'].join('\n'),
    );
  });

  it('ignora bloques desactivados', () => {
    const result = compileWorkspace(program({ type: 'robot_led_on', id: 'x', fields: { LED: '1' }, enabled: false }), caps('base'));
    expect(result.ok).toBe(true);
  });

  it('rechaza tipos de bloque desconocidos', () => {
    expect(compileWorkspace(program({ type: 'robot_teleport', id: 't' }), ALL).ok).toBe(false);
  });
});
