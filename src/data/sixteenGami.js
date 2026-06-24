// ═══════════════════════════════════════════════════════════
// 16-GAMI — Skyframe's Visual DNA
// Generates Nano Banana Pro prompts for ARES agents
// with selectable scene elements (environment, character, prop)
// ═══════════════════════════════════════════════════════════

export const AGENTS = [
  {
    id: 'oracle',
    name: 'The Oracle',
    role: 'Judge — Math-only verdict',
    color: '#ffff00',
    apparel: 'Ceremonial robes made of blue textured paper with jagged simulated pixelated fold lines and beige folded paper texture. High-collared.',
    held: 'Left pixelated clawed hand grips a 3D paper abacus made of beige textured paper and gold textured paper beads. Right hand holds glowing scales of justice as a separate pixelated paper sculpture on a multi-part paper arm.',
    head: 'dark grey sleek pixel-style face mask with glowing yellow visor pixel eyes',
    environment: {
      setting: 'ancient data temple with towering paper circuit-board columns',
      floor: 'gridded paper tiles with faint glowing pixel runes',
      atmosphere: 'dim and reverent, illuminated by the character\'s visor glow and scales',
    },
    prop: {
      object: 'stone evidence pedestal',
      placement: 'foreground-left',
      detail: 'made of dark grey layered cardstock with glowing cyan pixel inscriptions on its face',
    },
  },
  {
    id: 'architect',
    name: 'The Architect',
    role: 'Prosecution — Builds the case',
    color: '#00ff88',
    apparel: 'Tactical scout\'s trench coat made of olive green textured paper stock with jagged simulated pixelated fold lines and dark grey folded paper texture. High-collared.',
    held: 'Left pixelated clawed hand grips a 3D paper magnifying glass with black and silver layered paper frame and curved clear plastic insert. Right hand has rolled-up blueprints of glowing blue paper with etched white pixelated schema patterns tucked under arm.',
    head: 'dark grey sleek pixel-style face mask with glowing yellow visor pixel eyes',
    environment: {
      setting: 'cyber-forensics war room with paper holographic displays and data walls',
      floor: 'dark metallic gridded paper with faint green scan-line glow',
      atmosphere: 'focused and tactical, lit by blue blueprint glow and magnifying glass reflection',
    },
    prop: {
      object: 'evidence analysis terminal',
      placement: 'foreground-right',
      detail: 'made of dark cardstock frame with a cyan-glowing paper screen showing data readouts',
    },
  },
  {
    id: 'skeptic',
    name: 'The Skeptic',
    role: 'Defense — Pokes holes',
    color: '#00ccff',
    apparel: 'Heavy bulky Paladin armor made of gunmetal grey layered cardstock simulating burnished metal and steel grey geometric fold lines with stair-stepped pixelated contours. High-collared.',
    held: 'Left pixelated clawed hand plants a massive iron tower shield firmly on the ground, made of simulated riveted iron plates with 3D stair-stepped paper edges. At the utility belt, a glowing green Evidence Crystal made of layered green and translucent paper with blocky pixel shapes.',
    head: 'dark grey sleek pixel-style face mask with visor pulled down and narrow glowing yellow visor pixel eyes',
    environment: {
      setting: 'fortified paper bunker with layered cardstock blast walls and barricades',
      floor: 'cracked stone-grey paper tiles with scattered evidence fragments',
      atmosphere: 'defiant and guarded, lit by the green glow of an evidence crystal',
    },
    prop: {
      object: 'rejected evidence pile',
      placement: 'foreground-left',
      detail: 'crumpled red-stamped paper documents and broken pixel data shards scattered at the base of the shield',
    },
  },
];

// ─── Prompt Builder ───────────────────────────────────────

const STYLE_BLOCK = `Stair-stepped pixelated aesthetic merged with traditional origami folds. Multi-layered 3D cardstock construction. Soft directional lighting creating distinct drop shadows between physical paper layers. Hyper-realistic tangible texture contrasted with digital abstraction. 16-bit jagged physics reinforced by fold geometry.`;

export function buildSixteenGamiPrompt(agent, elements) {
  const { includeScene, includeCharacter, includeProp } = elements;
  const parts = [];

  // Camera / perspective (always present)
  parts.push('High-resolution product photograph of a physical, multi-layered cut paper and origami sculpture. Angled macro-level perspective with shallow depth of field emphasizing paper textures and cardstock grain.');

  // Scene / environment
  if (includeScene) {
    let sceneLine = `The scene is set inside a ${agent.environment.setting}. The floor is ${agent.environment.floor}. The atmosphere is ${agent.environment.atmosphere}.`;
    if (includeCharacter) {
      sceneLine = `The scene depicts a Cyber-Automaton robot standing inside a ${agent.environment.setting}. The floor is ${agent.environment.floor}. The atmosphere is ${agent.environment.atmosphere}.`;
    }
    parts.push(sceneLine);
  }

  // Character
  if (includeCharacter) {
    parts.push(`The character has a ${agent.head}. ${agent.apparel} ${agent.held}`);
  }

  // Prop
  if (includeProp) {
    parts.push(`In the ${agent.prop.placement} sits a ${agent.prop.object}, ${agent.prop.detail}.`);
  }

  // Background instruction when no scene
  if (!includeScene) {
    parts.push('Pure white solid background optimized for masking.');
  }

  // Style constants (always)
  parts.push(STYLE_BLOCK);

  return parts.join('\n\n');
}
