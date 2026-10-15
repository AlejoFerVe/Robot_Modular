import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from '../protocol/types';
import { buildExampleProgram } from '../program/examples';
import { setupBlockly } from './blocklySetup';
import { compileWorkspace, type WorkspaceState } from './compiler';
import { BLOCKS } from './definitions';

/** Comprueba las definiciones con el Blockly real (espacio de trabajo sin interfaz). */
describe('integración con Blockly', () => {
  const Blockly = setupBlockly();

  it('registra todos los bloques', () => {
    for (const def of BLOCKS) expect(Blockly.Blocks[def.type], def.type).toBeDefined();
  });

  it('crea cada bloque sin errores', () => {
    const ws = new Blockly.Workspace();
    for (const def of BLOCKS) expect(() => ws.newBlock(def.type)).not.toThrow();
    ws.dispose();
  });

  it('carga el ejemplo, lo serializa y el resultado compila igual', () => {
    const ws = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(buildExampleProgram(new Set(CAPABILITIES)) as object, ws);
    const saved = Blockly.serialization.workspaces.save(ws) as WorkspaceState;
    const result = compileWorkspace(saved, new Set(CAPABILITIES));
    expect(result.ok).toBe(true);
    ws.dispose();
  });

  it('las variables de Blockly llegan con su nombre al compilador', () => {
    const ws = new Blockly.Workspace();
    const start = ws.newBlock('robot_on_start');
    const set = ws.newBlock('robot_var_set');
    set.getField('VAR')?.setValue(ws.getVariableMap().createVariable('puntos').getId());
    const num = ws.newBlock('robot_number');
    if (!num.outputConnection || !set.previousConnection) throw new Error('conexiones ausentes');
    set.getInput('VALUE')?.connection?.connect(num.outputConnection);
    start.nextConnection?.connect(set.previousConnection);
    const result = compileWorkspace(Blockly.serialization.workspaces.save(ws) as WorkspaceState, new Set());
    expect(result.ok && result.program.body[0]).toMatchObject({ kind: 'set_var', name: 'puntos' });
    ws.dispose();
  });
});
