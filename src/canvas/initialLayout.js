import { scriptTypes, conversionLevels } from '../data/scriptTypes';

/**
 * Build the initial canvas layout for a given set of characters.
 * Places characters on the left, static nodes on the bottom-left,
 * and the generator hub in the center.
 */
export function buildInitialLayout(characters) {
  const nodes = [];
  const edges = [];

  // Place characters vertically on the left
  characters.forEach((char, i) => {
    nodes.push({
      id: `char-${char.id}`,
      type: 'character',
      position: { x: 50, y: 80 + i * 140 },
      data: { character: char },
    });
  });

  // Script types — bottom left cluster
  scriptTypes.forEach((st, i) => {
    nodes.push({
      id: `st-${st.id}`,
      type: 'scriptType',
      position: { x: 50, y: 80 + characters.length * 140 + 60 + i * 70 },
      data: { scriptType: st },
    });
  });

  // Conversion levels — below script types
  const cvStart = 80 + characters.length * 140 + 60 + scriptTypes.length * 70 + 40;
  conversionLevels.forEach((cl, i) => {
    nodes.push({
      id: `cv-${cl.id}`,
      type: 'conversionLevel',
      position: { x: 50, y: cvStart + i * 70 },
      data: { level: cl },
    });
  });

  // Script Generator — center
  nodes.push({
    id: 'generator-1',
    type: 'scriptGenerator',
    position: { x: 680, y: 200 },
    data: {},
  });

  // Output nodes — right of generator
  const outputX = 1020;
  const outputY = 120;
  nodes.push(
    { id: 'out-voice', type: 'voice', position: { x: outputX, y: outputY }, data: {} },
    { id: 'out-image', type: 'image', position: { x: outputX, y: outputY + 90 }, data: {} },
    { id: 'out-video', type: 'video', position: { x: outputX, y: outputY + 180 }, data: {} },
    { id: 'out-caption', type: 'caption', position: { x: outputX, y: outputY + 270 }, data: {} },
  );

  // Pre-wire output nodes to generator
  edges.push(
    { id: 'e-gen-voice', source: 'generator-1', target: 'out-voice', sourceHandle: 'script-out', targetHandle: 'script-in', type: 'pulse', data: {} },
    { id: 'e-gen-image', source: 'generator-1', target: 'out-image', sourceHandle: 'script-out', targetHandle: 'script-in', type: 'pulse', data: {} },
    { id: 'e-gen-video', source: 'generator-1', target: 'out-video', sourceHandle: 'script-out', targetHandle: 'script-in', type: 'pulse', data: {} },
    { id: 'e-gen-caption', source: 'generator-1', target: 'out-caption', sourceHandle: 'script-out', targetHandle: 'script-in', type: 'pulse', data: {} },
  );

  return { nodes, edges };
}

/**
 * Spawn pain point + hook nodes for a character, positioned around it.
 */
export function spawnIngredients(character, charNodeId, charPosition) {
  const nodes = [];
  const edges = [];
  const baseX = charPosition.x + 260;

  // Pain points above
  character.painPoints.forEach((pp, i) => {
    const id = `pp-${character.id}-${i}`;
    nodes.push({
      id,
      type: 'painPoint',
      position: { x: baseX, y: charPosition.y - 60 + i * 64 },
      data: { text: pp, index: i, accent: character.accentColor },
    });
    edges.push({
      id: `e-${charNodeId}-${id}`,
      source: charNodeId,
      target: id,
      sourceHandle: 'character-out',
      targetHandle: 'character-in',
      type: 'pulse',
      data: { color: character.accentColor },
    });
  });

  // Hooks below pain points
  const hookStartY = charPosition.y - 60 + character.painPoints.length * 64 + 30;
  character.hooks.forEach((hook, i) => {
    const id = `hk-${character.id}-${i}`;
    nodes.push({
      id,
      type: 'hook',
      position: { x: baseX, y: hookStartY + i * 64 },
      data: { text: hook, index: i, accent: character.accentColor },
    });
    edges.push({
      id: `e-${charNodeId}-${id}`,
      source: charNodeId,
      target: id,
      sourceHandle: 'character-out',
      targetHandle: 'character-in',
      type: 'pulse',
      data: { color: character.accentColor },
    });
  });

  return { nodes, edges };
}
