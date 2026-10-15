import type { Capability } from '../protocol/types';
import { BLOCKS, CATEGORIES, isBlockAvailable } from './definitions';

export interface ToolboxBlock {
  readonly kind: 'block';
  readonly type: string;
  readonly fields?: Readonly<Record<string, string | number>>;
  readonly inputs?: Readonly<Record<string, unknown>>;
}

export interface ToolboxButton {
  readonly kind: 'button';
  readonly text: string;
  readonly callbackKey: string;
}

export interface ToolboxCategory {
  readonly kind: 'category';
  readonly name: string;
  readonly colour: string;
  readonly contents: readonly (ToolboxBlock | ToolboxButton)[];
}

export interface Toolbox {
  readonly kind: 'categoryToolbox';
  readonly contents: readonly ToolboxCategory[];
}

export const CREATE_VARIABLE_CALLBACK = 'CREATE_VARIABLE';

/**
 * Construye la caja de herramientas a partir de las capacidades que el robot
 * ha informado. Las categorías sin bloques disponibles no se muestran.
 */
export function buildToolbox(caps: ReadonlySet<Capability>): Toolbox {
  const contents: ToolboxCategory[] = [];
  for (const category of CATEGORIES) {
    const blocks: (ToolboxBlock | ToolboxButton)[] = [];
    if (category.id === 'variables') {
      blocks.push({ kind: 'button', text: 'Crear variable', callbackKey: CREATE_VARIABLE_CALLBACK });
    }
    for (const def of BLOCKS) {
      if (def.category !== category.id || !isBlockAvailable(def, caps)) continue;
      for (const entry of def.toolbox ?? [{}]) {
        blocks.push({
          kind: 'block',
          type: def.type,
          ...(entry.fields ? { fields: entry.fields } : {}),
          ...(entry.inputs ? { inputs: entry.inputs } : {}),
        });
      }
    }
    if (blocks.some((b) => b.kind === 'block')) {
      contents.push({ kind: 'category', name: category.name, colour: category.colour, contents: blocks });
    }
  }
  return { kind: 'categoryToolbox', contents };
}

/** Tipos de bloque visibles con estas capacidades (útil para pruebas y diagnósticos). */
export function availableBlockTypes(caps: ReadonlySet<Capability>): string[] {
  return BLOCKS.filter((def) => isBlockAvailable(def, caps)).map((def) => def.type);
}
