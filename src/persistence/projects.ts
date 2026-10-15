/**
 * Guardado de proyectos en el navegador (localStorage) y en archivos .json.
 * Se guarda el estado serializado de Blockly, nunca código ejecutable.
 */

export const PROJECT_FORMAT_VERSION = 1;
const INDEX_KEY = 'robot-modular:projects';
const AUTOSAVE_KEY = 'robot-modular:autosave';
export const PROJECT_FILE_EXTENSION = '.robot.json';

export interface SavedProject {
  readonly format: 'robot-modular-project';
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly workspace: unknown;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class ProjectError extends Error {}

function parseProject(text: string): SavedProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectError('El archivo no es un proyecto válido.');
  }
  if (typeof data !== 'object' || data === null) throw new ProjectError('El archivo no es un proyecto válido.');
  const p = data as Record<string, unknown>;
  if (p['format'] !== 'robot-modular-project') throw new ProjectError('El archivo no es un proyecto de Robot Modular.');
  if (typeof p['formatVersion'] !== 'number' || p['formatVersion'] > PROJECT_FORMAT_VERSION) {
    throw new ProjectError('El proyecto se creó con una versión más nueva de la aplicación.');
  }
  if (typeof p['name'] !== 'string' || typeof p['id'] !== 'string') throw new ProjectError('Al proyecto le faltan datos.');
  if (typeof p['workspace'] !== 'object' || p['workspace'] === null) throw new ProjectError('El proyecto no tiene bloques.');
  return {
    format: 'robot-modular-project',
    formatVersion: p['formatVersion'],
    id: p['id'],
    name: p['name'],
    updatedAt: typeof p['updatedAt'] === 'string' ? p['updatedAt'] : new Date().toISOString(),
    workspace: p['workspace'],
  };
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Date.now()}${Math.random().toString(16).slice(2)}`;

export class ProjectStore {
  constructor(private readonly storage: KeyValueStorage) {}

  list(): ProjectSummary[] {
    const raw = this.storage.getItem(INDEX_KEY);
    if (!raw) return [];
    try {
      const data: unknown = JSON.parse(raw);
      if (!Array.isArray(data)) return [];
      return data
        .filter((x): x is ProjectSummary => typeof x?.id === 'string' && typeof x?.name === 'string' && typeof x?.updatedAt === 'string')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  save(name: string, workspace: unknown, id?: string): SavedProject {
    const cleanName = name.trim().slice(0, 60);
    if (!cleanName) throw new ProjectError('Escribe un nombre para el proyecto.');
    const project: SavedProject = {
      format: 'robot-modular-project',
      formatVersion: PROJECT_FORMAT_VERSION,
      id: id ?? newId(),
      name: cleanName,
      updatedAt: new Date().toISOString(),
      workspace,
    };
    this.storage.setItem(`${INDEX_KEY}:${project.id}`, JSON.stringify(project));
    const index = this.list().filter((p) => p.id !== project.id);
    index.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
    this.storage.setItem(INDEX_KEY, JSON.stringify(index));
    return project;
  }

  load(id: string): SavedProject {
    const raw = this.storage.getItem(`${INDEX_KEY}:${id}`);
    if (!raw) throw new ProjectError('No se encontró el proyecto.');
    return parseProject(raw);
  }

  remove(id: string): void {
    this.storage.removeItem(`${INDEX_KEY}:${id}`);
    this.storage.setItem(INDEX_KEY, JSON.stringify(this.list().filter((p) => p.id !== id)));
  }

  autosave(workspace: unknown): void {
    this.storage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), workspace }));
  }

  loadAutosave(): unknown {
    const raw = this.storage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as { workspace?: unknown };
      return typeof data.workspace === 'object' ? data.workspace : null;
    } catch {
      return null;
    }
  }
}

export function exportProject(name: string, workspace: unknown): string {
  const project: SavedProject = {
    format: 'robot-modular-project',
    formatVersion: PROJECT_FORMAT_VERSION,
    id: newId(),
    name: name.trim() || 'Mi programa',
    updatedAt: new Date().toISOString(),
    workspace,
  };
  return JSON.stringify(project, null, 2);
}

export function importProject(text: string): SavedProject {
  return parseProject(text);
}
