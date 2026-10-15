import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionController } from '../engine/ExecutionController';
import { ProjectStore } from '../persistence/projects';
import { RobotSession } from '../robot/RobotSession';
import { FAST_CLIENT, ScriptedTransport } from '../test/helpers';
import { App, type AppServices } from './App';
import { statusLabel } from './components/RobotStatusPanel';

// Blockly necesita un navegador real para dibujar; aquí se sustituye el editor
// por un doble que expone la caja de herramientas recibida.
vi.mock('./components/BlockEditor', () => ({
  BlockEditor: ({ toolbox }: { toolbox: { contents: { name: string }[] } }) => (
    <div data-testid="block-editor">{toolbox.contents.map((c) => c.name).join(',')}</div>
  ),
}));

// El simulador de la app usa tiempos reales; en las pruebas se acelera.
vi.mock('../simulator/SimulatedRobot', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../simulator/SimulatedRobot')>();
  class FastSimulatedRobot extends mod.SimulatedRobot {
    constructor() {
      super({ timeScale: 0.01, statusIntervalMs: 40 });
    }
  }
  return { ...mod, SimulatedRobot: FastSimulatedRobot };
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

let current: AppServices | null = null;

function makeServices(overrides: Partial<AppServices> = {}): AppServices {
  const session = new RobotSession(FAST_CLIENT);
  current = {
    session,
    controller: new ExecutionController(session, { loopDelayMs: 1 }),
    store: new ProjectStore(memoryStorage()),
    createSerialTransport: () => new ScriptedTransport(() => []),
    serialSupported: true,
    ...overrides,
  };
  return current;
}

afterEach(async () => {
  await current?.session.disconnect();
  current = null;
});

const moduleCard = (type: string) => screen.getByTestId(`module-${type}`);

describe('interfaz principal', () => {
  it('muestra el panel «Robot educativo» y la programación por bloques', () => {
    render(<App services={makeServices()} />);
    expect(screen.getByRole('heading', { name: /Robot educativo/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Programación por bloques/ })).toBeInTheDocument();
    expect(within(moduleCard('base')).getByText('Módulo 1 — Base')).toBeInTheDocument();
    expect(within(moduleCard('base')).getByText('Motores, servos y sensor de color')).toBeInTheDocument();
    expect(within(moduleCard('sensors')).getByText('Distancia, LED y buzzer')).toBeInTheDocument();
    expect(within(moduleCard('interface')).getByText('OLED y botones')).toBeInTheDocument();
    for (const b of ['Ejecutar', 'Detener', 'Reiniciar']) expect(screen.getByRole('button', { name: new RegExp(b) })).toBeInTheDocument();
  });

  it('sin robot no muestra ningún módulo como detectado', () => {
    render(<App services={makeServices()} />);
    for (const type of ['base', 'sensors', 'interface']) {
      expect(within(moduleCard(type)).getByRole('status')).toHaveTextContent('Sin conexión');
    }
    expect(screen.getByTestId('block-editor')).toHaveTextContent('Control,Comparaciones,Variables');
  });

  it('con el simulador muestra el aviso de modo simulado y los módulos detectados', async () => {
    const user = userEvent.setup();
    render(<App services={makeServices()} />);
    await user.click(screen.getByRole('button', { name: /Usar simulador/ }));
    await waitFor(() => expect(within(moduleCard('base')).getByRole('status')).toHaveTextContent('Activo'));
    expect(screen.getByText('MODO SIMULADOR')).toBeInTheDocument();
    expect(screen.getByText('SIMULADO')).toBeInTheDocument();
    expect(within(moduleCard('sensors')).getByRole('status')).toHaveTextContent('Detectado');
    expect(within(moduleCard('interface')).getByRole('status')).toHaveTextContent('Detectado');
    expect(screen.getByTestId('block-editor')).toHaveTextContent('Luces y sonido');
    expect(screen.getByTestId('block-editor')).toHaveTextContent('Pantalla y botones');
  });

  it('actualiza estados y bloques cuando un módulo se quita o falla', async () => {
    const user = userEvent.setup();
    render(<App services={makeServices()} />);
    await user.click(screen.getByRole('button', { name: /Usar simulador/ }));
    await waitFor(() => expect(within(moduleCard('sensors')).getByRole('status')).toHaveTextContent('Detectado'));

    await user.selectOptions(screen.getByLabelText('Módulo 2'), 'absent');
    await waitFor(() => expect(within(moduleCard('sensors')).getByRole('status')).toHaveTextContent('Desconectado'));
    expect(screen.getByTestId('block-editor')).not.toHaveTextContent('Luces y sonido');

    await user.selectOptions(screen.getByLabelText('Módulo 3'), 'error');
    await waitFor(() => expect(within(moduleCard('interface')).getByRole('status')).toHaveTextContent('Error'));
    expect(screen.getByTestId('block-editor')).not.toHaveTextContent('Pantalla y botones');
  });

  it('informa de la pérdida de comunicación', async () => {
    const user = userEvent.setup();
    render(<App services={makeServices()} />);
    await user.click(screen.getByRole('button', { name: /Usar simulador/ }));
    await waitFor(() => expect(within(moduleCard('base')).getByRole('status')).toHaveTextContent('Activo'));
    await user.click(screen.getByRole('button', { name: /Desenchufar cable/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cable USB se desconectó/));
    expect(within(moduleCard('base')).getByRole('status')).toHaveTextContent('Sin conexión');
  });

  it('pide conectar antes de ejecutar', async () => {
    const user = userEvent.setup();
    render(<App services={makeServices()} />);
    await user.click(screen.getByRole('button', { name: /Ejecutar/ }));
    expect(screen.getByText('Primero conecta el robot o usa el simulador.')).toBeInTheDocument();
  });

  it('el modo USB nunca se presenta como simulado', async () => {
    const transport = new ScriptedTransport((req) =>
      req['cmd'] === 'HELLO'
        ? [JSON.stringify({ v: 1, type: 'done', id: req['id'], result: { protocol: '1.0', robot: 'r', firmware: '0.1.0', modules: [{ type: 'base', typeId: 1, firmware: '0.1.0', capabilities: ['motion'], state: 'ok' }] } })]
        : [JSON.stringify({ v: 1, type: 'done', id: req['id'] })],
    );
    const user = userEvent.setup();
    render(<App services={makeServices({ createSerialTransport: () => transport })} />);
    await user.click(screen.getByRole('button', { name: /Conectar robot/ }));
    await waitFor(() => expect(within(moduleCard('base')).getByRole('status')).toHaveTextContent('Activo'));
    expect(screen.queryByText('MODO SIMULADOR')).not.toBeInTheDocument();
    expect(screen.getByText(/Conectado por USB/)).toBeInTheDocument();
    // El firmware solo informó «motion»: no aparecen brazos ni sensores.
    expect(screen.getByTestId('block-editor')).toHaveTextContent('Control,Movimiento,Comparaciones,Variables');
    expect(within(moduleCard('sensors')).getByRole('status')).toHaveTextContent('Desconectado');
  });

  it('desactiva USB si el navegador no lo admite', () => {
    render(<App services={makeServices({ serialSupported: false })} />);
    expect(screen.getByRole('button', { name: /Conectar robot/ })).toBeDisabled();
  });

  it('las etiquetas de estado no dependen solo del color', () => {
    expect(statusLabel('base', 'detected')).toMatchObject({ text: 'Activo', symbol: '✔' });
    expect(statusLabel('sensors', 'detected')).toMatchObject({ text: 'Detectado' });
    expect(statusLabel('sensors', 'error')).toMatchObject({ text: 'Error', symbol: '⚠' });
    expect(statusLabel('interface', 'disconnected')).toMatchObject({ text: 'Desconectado', symbol: '○' });
  });
});

