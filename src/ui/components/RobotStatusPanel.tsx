import type { ModuleType } from '../../protocol/types';
import type { ModuleStatus, ModuleView, ModuleViews } from '../../robot/modules';
import type { LinkState } from '../../robot/RobotSession';

interface ModuleInfo {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

export const MODULE_INFO: Readonly<Record<ModuleType, ModuleInfo>> = {
  base: { title: 'Módulo 1 — Base', description: 'Motores, servos y sensor de color', icon: '🛞' },
  sensors: { title: 'Módulo 2 — Sensores', description: 'Distancia, LED y buzzer', icon: '📡' },
  interface: { title: 'Módulo 3 — Interfaz', description: 'OLED y botones', icon: '🖥️' },
};

interface StatusLabel {
  readonly text: string;
  readonly symbol: string;
  readonly tone: 'ok' | 'off' | 'error' | 'unknown';
}

export function statusLabel(type: ModuleType, status: ModuleStatus): StatusLabel {
  switch (status) {
    case 'detected':
      return { text: type === 'base' ? 'Activo' : 'Detectado', symbol: '✔', tone: 'ok' };
    case 'disconnected':
      return { text: 'Desconectado', symbol: '○', tone: 'off' };
    case 'error':
      return { text: 'Error', symbol: '⚠', tone: 'error' };
    case 'unknown':
      return { text: 'Sin conexión', symbol: '?', tone: 'unknown' };
  }
}

function ModuleCard({ view }: { readonly view: ModuleView }) {
  const info = MODULE_INFO[view.type];
  const label = statusLabel(view.type, view.status);
  return (
    <li className={`module-card tone-${label.tone}`} data-testid={`module-${view.type}`}>
      <span className="module-icon" aria-hidden="true">
        {info.icon}
      </span>
      <div className="module-text">
        <strong>{info.title}</strong>
        <span className="module-desc">{info.description}</span>
        {view.status === 'error' && (
          <span className="module-hint">No responde bien. Revisa que esté bien encajado.</span>
        )}
      </div>
      <span className={`status-pill tone-${label.tone}`} role="status" aria-label={`${info.title}: ${label.text}`}>
        <span aria-hidden="true">{label.symbol}</span> {label.text}
      </span>
    </li>
  );
}

interface Props {
  readonly modules: ModuleViews;
  readonly link: LinkState;
  readonly simulated: boolean;
  readonly onRefresh: () => void;
}

export function RobotStatusPanel({ modules, link, simulated, onRefresh }: Props) {
  return (
    <section className="card status-card" aria-labelledby="robot-status-title">
      <header className="card-header">
        <h2 id="robot-status-title">
          <span aria-hidden="true">🤖</span> Robot educativo
        </h2>
        {link === 'connected' && (
          <button type="button" className="btn btn-ghost btn-small" onClick={onRefresh} title="Volver a buscar módulos">
            ↻ Buscar módulos
          </button>
        )}
      </header>
      {simulated && link === 'connected' && <p className="sim-note">Estos módulos son del simulador, no del robot real.</p>}
      {link !== 'connected' && <p className="muted">Conecta el robot para ver qué módulos tiene.</p>}
      <ul className="module-list">
        {(['base', 'sensors', 'interface'] as const).map((type) => (
          <ModuleCard key={type} view={modules[type]} />
        ))}
      </ul>
    </section>
  );
}
