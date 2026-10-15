import * as Blockly from 'blockly/core';
import * as Es from 'blockly/msg/es';
import { BLOCKS, toBlocklyJson } from './definitions';

let registered = false;

/** Registra los bloques del robot y el idioma español (una sola vez). */
export function setupBlockly(): typeof Blockly {
  if (!registered) {
    Blockly.setLocale(Es as unknown as Record<string, string>);
    Blockly.common.defineBlocksWithJsonArray(BLOCKS.map(toBlocklyJson));
    registered = true;
  }
  return Blockly;
}

export const robotTheme = Blockly.Theme.defineTheme('robot-modular', {
  name: 'robot-modular',
  base: Blockly.Themes.Classic,
  componentStyles: {
    workspaceBackgroundColour: '#F7F9FC',
    toolboxBackgroundColour: '#FFFFFF',
    toolboxForegroundColour: '#22304A',
    flyoutBackgroundColour: '#EEF2F8',
    flyoutOpacity: 1,
    scrollbarColour: '#C5CEDD',
    insertionMarkerColour: '#22304A',
  },
  fontStyle: { family: '"Nunito", "Segoe UI", system-ui, sans-serif', weight: '700', size: 12 },
  startHats: true,
});
