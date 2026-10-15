import { describe, expect, it } from 'vitest';
import { ProjectStore, exportProject, importProject, type KeyValueStorage } from './projects';

function memory(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

const ws = { blocks: { blocks: [{ type: 'robot_on_start', id: 's' }] } };

describe('proyectos', () => {
  it('guarda, lista, carga y borra', () => {
    const store = new ProjectStore(memory());
    const saved = store.save('  Mi robot  ', ws);
    expect(saved.name).toBe('Mi robot');
    expect(store.list()).toEqual([{ id: saved.id, name: 'Mi robot', updatedAt: saved.updatedAt }]);
    expect(store.load(saved.id).workspace).toEqual(ws);
    store.save('Mi robot v2', ws, saved.id);
    expect(store.list()).toHaveLength(1);
    store.remove(saved.id);
    expect(store.list()).toEqual([]);
    expect(() => store.load(saved.id)).toThrow('No se encontró');
  });

  it('exige un nombre', () => {
    expect(() => new ProjectStore(memory()).save('   ', ws)).toThrow('nombre');
  });

  it('recupera el autoguardado', () => {
    const store = new ProjectStore(memory());
    expect(store.loadAutosave()).toBeNull();
    store.autosave(ws);
    expect(store.loadAutosave()).toEqual(ws);
  });

  it('exporta e importa archivos', () => {
    const text = exportProject('Carrera', ws);
    expect(importProject(text)).toMatchObject({ name: 'Carrera', workspace: ws });
  });

  it.each([
    ['JSON roto', '{no'],
    ['otro formato', JSON.stringify({ format: 'otro' })],
    ['versión futura', JSON.stringify({ format: 'robot-modular-project', formatVersion: 99, id: 'a', name: 'x', workspace: {} })],
    ['sin bloques', JSON.stringify({ format: 'robot-modular-project', formatVersion: 1, id: 'a', name: 'x' })],
  ])('rechaza archivos no válidos: %s', (_n, text) => {
    expect(() => importProject(text)).toThrow();
  });

  it('tolera un índice corrupto', () => {
    const storage = memory();
    storage.setItem('robot-modular:projects', '{corrupto');
    expect(new ProjectStore(storage).list()).toEqual([]);
  });
});
