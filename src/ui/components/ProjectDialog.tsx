import { useRef, useState } from 'react';
import {
  PROJECT_FILE_EXTENSION,
  ProjectError,
  exportProject,
  importProject,
  type ProjectStore,
  type SavedProject,
} from '../../persistence/projects';

interface Props {
  readonly store: ProjectStore;
  readonly currentName: string;
  readonly currentId: string | null;
  readonly getWorkspace: () => unknown;
  readonly onOpen: (project: SavedProject) => void;
  readonly onSaved: (project: SavedProject) => void;
  readonly onClose: () => void;
}

export function ProjectDialog({ store, currentName, currentId, getWorkspace, onOpen, onSaved, onClose }: Props) {
  const [name, setName] = useState(currentName);
  const [projects, setProjects] = useState(() => store.list());
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const guard = (fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      setMessage(error instanceof ProjectError ? error.message : 'No se pudo completar la acción.');
    }
  };

  const save = (): void =>
    guard(() => {
      const sameName = projects.find((p) => p.name === name.trim());
      const project = store.save(name, getWorkspace(), sameName?.id ?? (name.trim() === currentName ? currentId ?? undefined : undefined));
      setProjects(store.list());
      setMessage(`Guardado «${project.name}».`);
      onSaved(project);
    });

  const download = (): void => {
    const blob = new Blob([exportProject(name, getWorkspace())], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.trim() || 'mi-programa'}${PROJECT_FILE_EXTENSION}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File): Promise<void> => {
    const text = await file.text();
    guard(() => onOpen(importProject(text)));
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="projects-title" onClick={(e) => e.stopPropagation()}>
        <header className="card-header">
          <h2 id="projects-title">📁 Mis proyectos</h2>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="dialog-row">
          <label className="grow">
            Nombre
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={save}>
            💾 Guardar
          </button>
        </div>

        {message && <p className="dialog-message" role="status">{message}</p>}

        <h3>Guardados en este equipo</h3>
        {projects.length === 0 ? (
          <p className="muted">Todavía no has guardado ningún proyecto.</p>
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id}>
                <span className="grow">
                  <strong>{p.name}</strong>
                  <span className="muted small"> · {new Date(p.updatedAt).toLocaleString('es')}</span>
                </span>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => guard(() => onOpen(store.load(p.id)))}>
                  Abrir
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={() => {
                    if (window.confirm(`¿Borrar «${p.name}»?`)) {
                      store.remove(p.id);
                      setProjects(store.list());
                    }
                  }}
                >
                  Borrar
                </button>
              </li>
            ))}
          </ul>
        )}

        <h3>Archivos</h3>
        <div className="dialog-row">
          <button type="button" className="btn btn-ghost" onClick={download}>
            ⬇ Descargar archivo
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
            ⬆ Abrir archivo
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
