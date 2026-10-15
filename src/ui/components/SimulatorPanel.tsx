import { useSyncExternalStore } from 'react';
import { COLOR_LABELS } from '../../blocks/definitions';
import { COLORS, type ColorName } from '../../protocol/types';
import type { SimModuleState, SimulatedRobot } from '../../simulator/SimulatedRobot';
import type { SimulatorTransport } from '../../simulator/SimulatorTransport';

interface Props {
  readonly robot: SimulatedRobot;
  readonly transport: SimulatorTransport;
}

const MOTION_TEXT = {
  stopped: 'quieto',
  forward: 'avanzando ⬆',
  backward: 'retrocediendo ⬇',
  left: 'girando ↶',
  right: 'girando ↷',
} as const;

const MODULE_OPTIONS: readonly [SimModuleState, string][] = [
  ['present', 'Conectado'],
  ['absent', 'Quitado'],
  ['error', 'Con fallo'],
];

/** Controles del robot virtual. Todo lo que muestra es simulado. */
export function SimulatorPanel({ robot, transport }: Props) {
  const sim = useSyncExternalStore(
    (listener) => robot.onChange(listener),
    () => robot.snapshot(),
  );

  return (
    <section className="card sim-card" aria-labelledby="sim-title">
      <header className="card-header">
        <h2 id="sim-title">
          <span aria-hidden="true">🧪</span> Robot virtual
        </h2>
        <span className="sim-tag">SIMULADO</span>
      </header>

      <div className="sim-grid">
        <div className="sim-display" aria-label="Pantalla simulada">
          {sim.modules.interface === 'present' ? sim.display || <span className="muted">(pantalla vacía)</span> : '—'}
        </div>
        <dl className="sim-readout">
          <dt>Ruedas</dt>
          <dd>
            {MOTION_TEXT[sim.motion]}
            {sim.motion !== 'stopped' && ` (${sim.speed} %)`}
          </dd>
          <dt>Hombros</dt>
          <dd>
            izq. {sim.servos.shoulder_left}° · der. {sim.servos.shoulder_right}°
          </dd>
          <dt>Pinzas</dt>
          <dd>
            izq. {sim.servos.gripper_left > 0 ? 'abierta' : 'cerrada'} · der. {sim.servos.gripper_right > 0 ? 'abierta' : 'cerrada'}
          </dd>
          <dt>LED</dt>
          <dd className="sim-leds">
            {sim.leds.map((on, i) => (
              <span key={i} className={`sim-led ${on ? 'on' : ''}`} aria-label={`LED ${i + 1} ${on ? 'encendido' : 'apagado'}`}>
                {i + 1}
              </span>
            ))}
            {sim.buzzer && <span aria-label="zumbador sonando"> 🔔</span>}
          </dd>
        </dl>
      </div>

      <fieldset className="sim-controls">
        <legend>Piezas conectadas</legend>
        {(['sensors', 'interface'] as const).map((module) => (
          <label key={module}>
            {module === 'sensors' ? 'Módulo 2' : 'Módulo 3'}
            <select value={sim.modules[module]} onChange={(e) => robot.setModuleState(module, e.target.value as SimModuleState)}>
              {MODULE_OPTIONS.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <fieldset className="sim-controls">
        <legend>Lecturas simuladas</legend>
        <label>
          Distancia: {sim.distanceCm} cm
          <input type="range" min={2} max={200} value={sim.distanceCm} onChange={(e) => robot.setDistance(Number(e.target.value))} />
        </label>
        <label>
          Color
          <select value={sim.color} onChange={(e) => robot.setColor(e.target.value as ColorName)}>
            {COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <div className="sim-buttons">
          {(['A', 'B'] as const).map((b) => (
            <button
              key={b}
              type="button"
              className={`btn btn-small ${sim.buttons[b] ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={sim.buttons[b]}
              onClick={() => robot.setButton(b, !sim.buttons[b])}
            >
              Botón {b} {sim.buttons[b] ? '(pulsado)' : ''}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="sim-controls">
        <legend>Probar fallos</legend>
        <div className="sim-buttons">
          <button type="button" className="btn btn-small btn-ghost" onClick={() => robot.setResponsive(!sim.responsive)}>
            {sim.responsive ? 'Dejar de responder' : 'Volver a responder'}
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => transport.unplug()}>
            Desenchufar cable
          </button>
        </div>
      </fieldset>
    </section>
  );
}
