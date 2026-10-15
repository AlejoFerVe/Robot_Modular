import type { SerializedBlock, WorkspaceState } from '../blocks/compiler';
import type { Capability } from '../protocol/types';

/** Encadena bloques con "next". */
function sequence(blocks: SerializedBlock[]): SerializedBlock | undefined {
  return blocks.reduceRight<SerializedBlock | undefined>(
    (next, block) => (next ? { ...block, next: { block: next } } : block),
    undefined,
  );
}

/**
 * Programa de ejemplo:
 *   AL INICIAR → mostrar «Hola» → repetir 3 veces { avanzar, girar a la derecha }
 * Solo incluye bloques que el robot conectado puede ejecutar.
 */
export function buildExampleProgram(caps: ReadonlySet<Capability>): WorkspaceState {
  const steps: SerializedBlock[] = [];
  if (caps.has('display')) {
    steps.push({ type: 'robot_display_text', id: 'ex_hello', fields: { TEXT: 'Hola' } });
  }
  const loopBody = caps.has('motion')
    ? sequence([
        { type: 'robot_move_forward', id: 'ex_forward', fields: { SECONDS: 1 } },
        { type: 'robot_turn_right', id: 'ex_turn', fields: { SECONDS: 0.5 } },
      ])
    : sequence([{ type: 'robot_wait', id: 'ex_wait', fields: { SECONDS: 1 } }]);
  steps.push({
    type: 'robot_repeat',
    id: 'ex_repeat',
    fields: { TIMES: 3 },
    ...(loopBody ? { inputs: { DO: { block: loopBody } } } : {}),
  });
  const body = sequence(steps);
  return {
    blocks: {
      blocks: [{ type: 'robot_on_start', id: 'ex_start', ...(body ? { next: { block: body } } : {}), x: 40, y: 40 } as SerializedBlock],
    },
  };
}

export function emptyProgram(): WorkspaceState {
  return { blocks: { blocks: [{ type: 'robot_on_start', id: 'start', x: 40, y: 40 } as SerializedBlock] } };
}
