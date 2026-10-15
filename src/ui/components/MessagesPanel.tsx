import { useState } from 'react';
import type { CompileIssue } from '../../blocks/compiler';
import type { LogEntry } from '../../engine/ExecutionController';

interface Props {
  readonly log: readonly LogEntry[];
  readonly errors: readonly CompileIssue[];
  readonly warnings: readonly CompileIssue[];
  readonly instructions: string | null;
  readonly onClear: () => void;
}

type Tab = 'messages' | 'instructions';

export function MessagesPanel({ log, errors, warnings, instructions, onClear }: Props) {
  const [tab, setTab] = useState<Tab>('messages');
  const problems = errors.length + warnings.length;
  return (
    <div className="messages">
      <div className="tabs" role="tablist" aria-label="Información del programa">
        <button type="button" role="tab" aria-selected={tab === 'messages'} onClick={() => setTab('messages')}>
          Mensajes {problems > 0 && <span className="badge">{problems}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'instructions'} onClick={() => setTab('instructions')}>
          Instrucciones
        </button>
        {tab === 'messages' && log.length > 0 && (
          <button type="button" className="btn btn-ghost btn-small tabs-action" onClick={onClear}>
            Limpiar
          </button>
        )}
      </div>

      {tab === 'messages' ? (
        <ul className="message-list" aria-live="polite">
          {errors.map((e, i) => (
            <li key={`e${i}`} className="msg msg-error">
              <span aria-hidden="true">⛔</span> {e.message}
            </li>
          ))}
          {warnings.map((w, i) => (
            <li key={`w${i}`} className="msg msg-warn">
              <span aria-hidden="true">💡</span> {w.message}
            </li>
          ))}
          {log.map((entry) => (
            <li key={entry.id} className={`msg msg-${entry.event.level}`}>
              {entry.event.level === 'error' && <span aria-hidden="true">⛔ </span>}
              {entry.event.level === 'command' ? <code>{entry.event.text}</code> : entry.event.text}
            </li>
          ))}
          {problems === 0 && log.length === 0 && <li className="msg muted">Aquí verás lo que hace tu programa.</li>}
        </ul>
      ) : (
        <pre className="instructions" aria-label="Instrucciones generadas">
          {instructions ?? 'Arregla los errores del programa para ver sus instrucciones.'}
        </pre>
      )}
    </div>
  );
}
