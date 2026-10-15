import { describe, expect, it } from 'vitest';
import type { ModuleReport } from '../protocol/types';
import { availableCapabilities, deriveModuleViews, lostCapabilities } from './modules';

const base: ModuleReport = { type: 'base', typeId: 1, firmware: '1.0.0', capabilities: ['motion', 'arms', 'color_sensor'], state: 'ok' };
const sensors: ModuleReport = { type: 'sensors', typeId: 2, firmware: '1.0.0', capabilities: ['distance', 'leds', 'buzzer'], state: 'ok' };

describe('estado de módulos', () => {
  it('sin conexión ningún módulo aparece como detectado', () => {
    const views = deriveModuleViews(null);
    expect(Object.values(views).map((v) => v.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(availableCapabilities(views).size).toBe(0);
  });

  it('distingue detectado, desconectado y error', () => {
    const views = deriveModuleViews([
      base,
      { type: 'sensors', typeId: 2, firmware: '1.0.0', capabilities: [], state: 'error', error: 'I2C_ERROR' },
      { type: 'interface', typeId: 3, firmware: '', capabilities: [], state: 'absent' },
    ]);
    expect(views.base.status).toBe('detected');
    expect(views.sensors.status).toBe('error');
    expect(views.sensors.error).toBe('I2C_ERROR');
    expect(views.interface.status).toBe('disconnected');
  });

  it('un módulo que no aparece en el informe está desconectado', () => {
    expect(deriveModuleViews([base]).interface.status).toBe('disconnected');
  });

  it('las capacidades salen solo de módulos detectados', () => {
    const caps = availableCapabilities(deriveModuleViews([base, sensors]));
    expect([...caps].sort()).toEqual(['arms', 'buzzer', 'color_sensor', 'distance', 'leds', 'motion']);
  });

  it('calcula las capacidades perdidas', () => {
    expect(lostCapabilities(new Set(['motion', 'distance']), new Set(['motion']))).toEqual(['distance']);
  });
});
