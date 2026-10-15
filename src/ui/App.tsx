import { useCallback, useEffect, useState } from 'react';
import { ExecutionController } from '../engine/ExecutionController';
import { ProjectStore, type KeyValueStorage } from '../persistence/projects';
import { RobotSession } from '../robot/RobotSession';
import { SimulatedRobot } from '../simulator/SimulatedRobot';
import { SimulatorTransport } from '../simulator/SimulatorTransport';
import type { Transport } from '../transport/Transport';
import { WebSerialTransport, isWebSerialSupported } from '../transport/WebSerialTransport';
import { ConnectionBar } from './components/ConnectionBar';
import { ProgramPanel } from './components/ProgramPanel';
import { RobotStatusPanel } from './components/RobotStatusPanel';
import { SimulatorPanel } from './components/SimulatorPanel';
import { useStore } from './hooks/useStore';

export interface AppServices {
  readonly session: RobotSession;
  readonly controller: ExecutionController;
  readonly store: ProjectStore;
  /** Fábrica del transporte USB (se sustituye en pruebas). */
  readonly createSerialTransport: () => Transport;
  readonly serialSupported: boolean;
}

const memoryStorage = (): KeyValueStorage => {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
};

function safeLocalStorage(): KeyValueStorage {
  try {
    const probe = '__robot_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

export function createServices(): AppServices {
  const session = new RobotSession();
  return {
    session,
    controller: new ExecutionController(session),
    store: new ProjectStore(safeLocalStorage()),
    createSerialTransport: () => new WebSerialTransport(),
    serialSupported: isWebSerialSupported(),
  };
}

interface Simulation {
  readonly robot: SimulatedRobot;
  readonly transport: SimulatorTransport;
}

export function App({ services }: { readonly services: AppServices }) {
  const { session, controller, store } = services;
  const sessionState = useStore(session);
  const execution = useStore(controller);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      session.onTraffic((entry) => {
        if (entry.direction === 'warn') controller.log({ level: 'error', text: entry.text });
      }),
    [session, controller],
  );

  const connect = useCallback(
    async (transport: Transport) => {
      setBusy(true);
      try {
        await session.connect(transport);
      } catch {
        // El aviso ya queda en el estado de la sesión.
      } finally {
        setBusy(false);
      }
    },
    [session],
  );

  const connectSimulator = (): void => {
    const robot = new SimulatedRobot();
    const transport = new SimulatorTransport(robot);
    setSimulation({ robot, transport });
    void connect(transport);
  };

  const connectSerial = (): void => {
    setSimulation(null);
    void connect(services.createSerialTransport());
  };

  const disconnect = (): void => {
    void controller.stop().finally(() => session.disconnect());
    setSimulation(null);
  };

  const refresh = (): void => {
    session.refreshModules().catch(() => controller.log({ level: 'error', text: 'No se pudo actualizar la lista de módulos.' }));
  };

  const simulated = sessionState.transport === 'simulator';

  return (
    <div className={`app ${simulated ? 'is-simulated' : ''}`}>
      <header className="app-header">
        <h1>
          <span aria-hidden="true">🤖</span> Robot Modular
        </h1>
        <ConnectionBar
          session={sessionState}
          serialSupported={services.serialSupported}
          busy={busy}
          onConnectSerial={connectSerial}
          onConnectSimulator={connectSimulator}
          onDisconnect={disconnect}
        />
      </header>

      {simulated && (
        <div className="sim-banner" role="note">
          <strong>MODO SIMULADOR</strong> — No hay un robot real conectado. Los datos y lecturas que ves son inventados.
        </div>
      )}
      {sessionState.notice && (
        <div className={`app-notice ${sessionState.link === 'lost' ? 'is-error' : ''}`} role="alert">
          {sessionState.notice}
        </div>
      )}

      <main className="layout">
        <aside className="side">
          <RobotStatusPanel modules={sessionState.modules} link={sessionState.link} simulated={simulated} onRefresh={refresh} />
          {simulation && <SimulatorPanel robot={simulation.robot} transport={simulation.transport} />}
          <HelpCard />
        </aside>
        <ProgramPanel session={sessionState} execution={execution} controller={controller} store={store} />
      </main>
    </div>
  );
}

function HelpCard() {
  return (
    <section className="card help-card" aria-labelledby="help-title">
      <h2 id="help-title">
        <span aria-hidden="true">💡</span> ¿Cómo empiezo?
      </h2>
      <ol>
        <li>Conecta el robot con el cable USB (o prueba el simulador).</li>
        <li>Arrastra bloques debajo de <strong>▶ Al iniciar</strong>.</li>
        <li>Pulsa <strong>▶ Ejecutar</strong>. Para parar, pulsa <strong>■ Detener</strong> o la tecla Esc.</li>
      </ol>
      <p className="muted small">Solo verás los bloques de las piezas que el robot tiene conectadas.</p>
    </section>
  );
}
