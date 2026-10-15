import type { SessionSnapshot } from '../../robot/RobotSession';

interface Props {
  readonly session: SessionSnapshot;
  readonly serialSupported: boolean;
  readonly busy: boolean;
  readonly onConnectSerial: () => void;
  readonly onConnectSimulator: () => void;
  readonly onDisconnect: () => void;
}

const LINK_TEXT = {
  disconnected: 'Sin conectar',
  connecting: 'Conectando…',
  connected: 'Conectado',
  lost: 'Conexión perdida',
} as const;

export function ConnectionBar({ session, serialSupported, busy, onConnectSerial, onConnectSimulator, onDisconnect }: Props) {
  const { link, transport, robot } = session;
  const connected = link === 'connected';
  const via = transport === 'simulator' ? 'simulador' : 'USB';
  return (
    <div className="connection-bar">
      <span className={`link-indicator link-${link}`} role="status" aria-live="polite">
        <span className="dot" aria-hidden="true" />
        {LINK_TEXT[link]}
        {connected && ` por ${via}`}
        {connected && robot && <span className="muted small"> · firmware {robot.firmware}</span>}
      </span>
      {connected || link === 'connecting' ? (
        <button type="button" className="btn btn-ghost" onClick={onDisconnect} disabled={busy}>
          Desconectar
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConnectSerial}
            disabled={!serialSupported || busy}
            title={serialSupported ? 'Conectar el robot por cable USB' : 'Tu navegador no permite USB. Usa Chrome o Edge.'}
          >
            🔌 Conectar robot (USB)
          </button>
          <button type="button" className="btn btn-secondary" onClick={onConnectSimulator} disabled={busy}>
            🧪 Usar simulador
          </button>
        </>
      )}
    </div>
  );
}
