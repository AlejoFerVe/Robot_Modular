import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type * as BlocklyType from 'blockly/core';
import { setupBlockly, robotTheme } from '../../blocks/blocklySetup';
import type { CompileIssue, WorkspaceState } from '../../blocks/compiler';
import { CREATE_VARIABLE_CALLBACK, type Toolbox } from '../../blocks/toolbox';

export interface BlockEditorHandle {
  load(state: WorkspaceState): void;
  getState(): WorkspaceState;
}

interface Props {
  readonly ref?: Ref<BlockEditorHandle>;
  readonly toolbox: Toolbox;
  readonly initialState: WorkspaceState;
  readonly onChange: (state: WorkspaceState) => void;
  readonly activeBlockId: string | null;
  readonly issues: readonly CompileIssue[];
}

const WARNING_ID = 'robot-compile';

/** Envoltorio de Blockly. Solo se ocupa de la parte visual del editor. */
export function BlockEditor({ ref, toolbox, initialState, onChange, activeBlockId, issues }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<BlocklyType.WorkspaceSvg | null>(null);
  const blocklyRef = useRef<typeof BlocklyType | null>(null);
  const onChangeRef = useRef(onChange);
  const lastJson = useRef('');
  const initialRef = useRef(initialState);
  const toolboxRef = useRef(toolbox);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const Blockly = setupBlockly();
    blocklyRef.current = Blockly;
    const workspace = Blockly.inject(host, {
      toolbox: toolboxRef.current as unknown as BlocklyType.utils.toolbox.ToolboxDefinition,
      theme: robotTheme,
      renderer: 'zelos',
      trashcan: true,
      sounds: false,
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.4 },
      move: { scrollbars: true, drag: true, wheel: false },
      grid: { spacing: 24, length: 2, colour: '#DCE3EE', snap: true },
    });
    workspaceRef.current = workspace;
    workspace.registerButtonCallback(CREATE_VARIABLE_CALLBACK, () => Blockly.Variables.createVariableButtonHandler(workspace));

    const emit = (): void => {
      const state = Blockly.serialization.workspaces.save(workspace) as WorkspaceState;
      const json = JSON.stringify(state);
      if (json === lastJson.current) return;
      lastJson.current = json;
      onChangeRef.current(state);
    };

    Blockly.serialization.workspaces.load(initialRef.current as object, workspace);
    emit();
    workspace.addChangeListener((event: BlocklyType.Events.Abstract) => {
      if (event.isUiEvent) return;
      emit();
    });

    const resize = new ResizeObserver(() => Blockly.svgResize(workspace));
    resize.observe(host);
    return () => {
      resize.disconnect();
      workspace.dispose();
      workspaceRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      load(state: WorkspaceState) {
        const workspace = workspaceRef.current;
        const Blockly = blocklyRef.current;
        if (!workspace || !Blockly) return;
        workspace.clear();
        Blockly.serialization.workspaces.load(state as object, workspace);
        workspace.scrollCenter();
      },
      getState() {
        const workspace = workspaceRef.current;
        const Blockly = blocklyRef.current;
        if (!workspace || !Blockly) return {};
        return Blockly.serialization.workspaces.save(workspace) as WorkspaceState;
      },
    }),
    [],
  );

  useEffect(() => {
    workspaceRef.current?.updateToolbox(toolbox as unknown as BlocklyType.utils.toolbox.ToolboxDefinition);
  }, [toolbox]);

  useEffect(() => {
    workspaceRef.current?.highlightBlock(activeBlockId);
  }, [activeBlockId]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const byBlock = new Map<string, string>();
    for (const issue of issues) {
      if (issue.blockId) byBlock.set(issue.blockId, [byBlock.get(issue.blockId), issue.message].filter(Boolean).join('\n'));
    }
    for (const block of workspace.getAllBlocks(false)) {
      const text = byBlock.get(block.id) ?? null;
      block.setWarningText(text, WARNING_ID);
    }
  }, [issues]);

  return <div ref={hostRef} className="block-editor" role="application" aria-label="Editor de bloques" />;
}
