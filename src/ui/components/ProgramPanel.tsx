import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { compileWorkspace, type WorkspaceState } from '../../blocks/compiler';
import { buildToolbox } from '../../blocks/toolbox';
import { CAPABILITIES } from '../../protocol/types';
import type { ExecutionController, ExecutionSnapshot } from '../../engine/ExecutionController';
import { buildExampleProgram, emptyProgram } from '../../program/examples';
import { formatProgram } from '../../program/ir';
import type { ProjectStore, SavedProject } from '../../persistence/projects';
import type { SessionSnapshot } from '../../robot/RobotSession';
import { BlockEditor, type BlockEditorHandle } from './BlockEditor';
import { MessagesPanel } from './MessagesPanel';
import { ProjectDialog } from './ProjectDialog';

interface Props {
  readonly session: SessionSnapshot;
  readonly execution: ExecutionSnapshot;
  readonly controller: ExecutionController;
  readonly store: ProjectStore;
}

const ALL_CAPABILITIES: ReadonlySet<(typeof CAPABILITIES)[number]> = new Set(CAPABILITIES);

function initialWorkspace(store: ProjectStore): WorkspaceState {
  const saved = store.loadAutosave();
  return saved && typeof saved === 'object' ? (saved as WorkspaceState) : emptyProgram();
}

export function ProgramPanel({ session, execution, controller, store }: Props) {
  const editor = useRef<BlockEditorHandle>(null);
  const [initial] = useState(() => initialWorkspace(store));
  const [workspace, setWorkspace] = useState<WorkspaceState>(initial);
  const [project, setProject] = useState<{ id: string | null; name: string }>({ id: null, name: 'Mi programa' });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const connected = session.link === 'connected';
  const running = execution.state !== 'idle';
  const toolbox = useMemo(() => buildToolbox(session.capabilities), [session.capabilities]);
  // Sin robot conectado se revisa solo la estructura (todas las capacidades
  // supuestas); al conectar, también se comprueba qué bloques puede ejecutar.
  const compiled = useMemo(
    () => compileWorkspace(workspace, connected ? session.capabilities : ALL_CAPABILITIES),
    [workspace, connected, session.capabilities],
  );

  const errors = useMemo(() => (compiled.ok ? [] : compiled.errors), [compiled]);
  const issues = useMemo(
    () => [...errors, ...compiled.warnings, ...(execution.errorBlockId ? [{ blockId: execution.errorBlockId, message: 'Aquí ocurrió un error.' }] : [])],
    [errors, compiled.warnings, execution.errorBlockId],
  );

  const handleChange = useCallback(
    (state: WorkspaceState) => {
      setWorkspace(state);
      store.autosave(state);
    },
    [store],
  );

  const run = useCallback(async () => {
    setNotice(null);
    if (!connected) {
      setNotice('Primero conecta el robot o usa el simulador.');
      return;
    }
    if (!compiled.ok) {
      setNotice('Tu programa tiene errores. Mira los mensajes de abajo.');
      return;
    }
    await controller.run(compiled.program);
  }, [connected, compiled, controller]);

  const stop = useCallback(() => {
    void controller.stop();
  }, [controller]);

  const restart = useCallback(async () => {
    if (controller.getSnapshot().state !== 'idle') {
      await controller.stop();
      await new Promise<void>((resolve) => {
        const unsubscribe = controller.subscribe(() => {
          if (controller.getSnapshot().state === 'idle') {
            unsubscribe();
            resolve();
          }
        });
        if (controller.getSnapshot().state === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    }
    controller.clearLog();
    await run();
  }, [controller, run]);

  // Tecla Escape: parada rápida.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void controller.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  const loadExample = (): void => {
    if (!connected) {
      setNotice('Conecta el robot para crear un ejemplo con los módulos que tiene.');
      return;
    }
    editor.current?.load(buildExampleProgram(session.capabilities));
    setNotice('Ejemplo cargado. ¡Pulsa Ejecutar!');
  };

  const newProgram = (): void => {
    if (!window.confirm('¿Empezar un programa nuevo? Se borrarán los bloques actuales.')) return;
    editor.current?.load(emptyProgram());
    setProject({ id: null, name: 'Mi programa' });
  };

  const openProject = (p: SavedProject): void => {
    editor.current?.load(p.workspace as WorkspaceState);
    setProject({ id: p.id, name: p.name });
    setDialogOpen(false);
    setNotice(`Proyecto «${p.name}» abierto.`);
  };

  return (
    <section className="card program-card" aria-labelledby="program-title">
      <header className="card-header program-header">
        <h2 id="program-title">
          <span aria-hidden="true">🧩</span> Programación por bloques
          <span className="project-name muted small"> · {project.name}</span>
        </h2>
        <div className="toolbar" role="toolbar" aria-label="Controles del programa">
          <button type="button" className="btn btn-run" onClick={() => void run()} disabled={running}>
            ▶ Ejecutar
          </button>
          <button type="button" className="btn btn-stop" onClick={stop} disabled={!connected} title="Detener el robot (tecla Esc)">
            ■ Detener
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void restart()} disabled={!connected}>
            ↺ Reiniciar
          </button>
          <span className="toolbar-sep" aria-hidden="true" />
          <button type="button" className="btn btn-ghost" onClick={loadExample} disabled={running}>
            ✨ Ejemplo
          </button>
          <button type="button" className="btn btn-ghost" onClick={newProgram} disabled={running}>
            📄 Nuevo
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setDialogOpen(true)} disabled={running}>
            📁 Proyectos
          </button>
        </div>
      </header>

      {running && (
        <p className="run-banner" role="status">
          {execution.state === 'stopping' ? 'Deteniendo…' : '▶ Tu programa se está ejecutando. Pulsa ■ Detener o la tecla Esc para pararlo.'}
        </p>
      )}
      {notice && !running && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="editor-wrap">
        <BlockEditor
          ref={editor}
          toolbox={toolbox}
          initialState={initial}
          onChange={handleChange}
          activeBlockId={execution.activeBlockId}
          issues={issues}
        />
      </div>

      <MessagesPanel
        log={execution.log}
        errors={errors}
        warnings={compiled.warnings}
        instructions={compiled.ok ? formatProgram(compiled.program) : null}
        onClear={() => controller.clearLog()}
      />

      {dialogOpen && (
        <ProjectDialog
          store={store}
          currentName={project.name}
          currentId={project.id}
          getWorkspace={() => editor.current?.getState() ?? workspace}
          onOpen={openProject}
          onSaved={(p) => setProject({ id: p.id, name: p.name })}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </section>
  );
}
