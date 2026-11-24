import type { SessionSnapshot } from '../../robot/RobotSession';

interface Props {
  readonly session: SessionSnapshot;
  readonly serialSupported: boolean;
  readonly busy: boolean;
  readonly wifiHost: string;
  readonly onWifiHostChange: (host: string) => void;
  readonly onConnectSerial: () => void;
  readonly onConnectWifi: () => void;
  readonly onConnectSimulator: () => void;
  readonly onDisconnect: () => void;
}

const LINK_TEXT = {
  disconnected: 'Sin conectar',
  connecting: 'Conectando…',
  connected: 'Conectado',
  lost: 'Conexión perdida',
} as const;

const VIA = { simulator: 'simulador', serial: 'USB', wifi: 'Wi‑Fi' } as const;

export function ConnectionBar({
  session,
  serialSupported,
  busy,
  wifiHost,
  onWifiHostChange,
  onConnectSerial,
  onConnectWifi,
  onConnectSimulator,
  onDisconnect,
}: Props) {
  const { link, transport, robot } = session;
  const connected = link === 'connected';
  const via = VIA[transport ?? 'serial'];
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
          <span className="wifi-connect">
            <input
              type="text"
              className="wifi-host"
              aria-label="Dirección Wi‑Fi del robot"
              value={wifiHost}
              onChange={(e) => onWifiHostChange(e.target.value)}
              spellCheck={false}
              size={13}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={onConnectWifi}
              disabled={busy}
              title="Primero conecta tu PC a la red Wi‑Fi del robot (RobotModular)"
            >
              📶 Conectar por Wi‑Fi
            </button>
          </span>
          <button type="button" className="btn btn-secondary" onClick={onConnectSimulator} disabled={busy}>
            🧪 Usar simulador
          </button>
        </>
      )}
    </div>
  );
}
