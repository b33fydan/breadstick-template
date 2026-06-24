/* ===== PIXEL ART PROMPT FORGE — Data & Builder ===== */

export const bitDepths = [
  {
    id: '8',
    label: '8-bit',
    era: '1983–1990',
    console: 'NES / Game Boy',
    modifier: '8-bit pixel art, NES style, limited color palette',
    pixelIt: { blockSize: '8–16', maxColors: '4–16' },
  },
  {
    id: '16',
    label: '16-bit',
    era: '1990–1996',
    console: 'SNES / Genesis',
    modifier: '16-bit pixel art, SNES style, rich color palette',
    pixelIt: { blockSize: '4–8', maxColors: '32–64' },
  },
  {
    id: '24',
    label: '24-bit',
    era: '1996–2000',
    console: 'PS1 / GBA',
    modifier: '24-bit pixel art, PlayStation style, smooth gradients',
    pixelIt: { blockSize: '2–4', maxColors: '128' },
  },
  {
    id: '32',
    label: '32-bit',
    era: '2000–2005',
    console: 'Dreamcast / DS',
    modifier: '32-bit pixel art, Sega Dreamcast style, highly detailed',
    pixelIt: { blockSize: '1–2', maxColors: '256' },
  },
];

export const stylePresets = [
  // Dark / Gothic
  { id: 'castlevania', label: 'Castlevania', category: 'Dark', fragment: 'style of castlevania 1986, dark gothic' },
  { id: 'blasphemous', label: 'Blasphemous', category: 'Dark', fragment: 'style of blasphemous, dark religious pixel art' },
  { id: 'darksouls', label: 'Dark Souls Demake', category: 'Dark', fragment: 'dark fantasy pixel art, gritty, muted palette' },
  // Action
  { id: 'metalslug', label: 'Metal Slug', category: 'Action', fragment: 'style of metal slug 1996, chunky detailed' },
  { id: 'contra', label: 'Contra', category: 'Action', fragment: 'style of contra NES, action pixel art' },
  { id: 'megaman', label: 'Mega Man', category: 'Action', fragment: 'style of mega man, clean pixel art, bright colors' },
  // Adventure / RPG
  { id: 'zelda', label: 'Zelda: LttP', category: 'RPG', fragment: 'top down 2d, style of Legend of Zelda: A Link to the Past (SNES) 1991' },
  { id: 'finalfantasy', label: 'Final Fantasy VI', category: 'RPG', fragment: 'style of final fantasy VI SNES, detailed RPG pixel art' },
  { id: 'chronotrigger', label: 'Chrono Trigger', category: 'RPG', fragment: 'style of chrono trigger SNES, vibrant detailed pixel art' },
  { id: 'cavestory', label: 'Cave Story', category: 'RPG', fragment: 'style of cave story, cute pixel art' },
  { id: 'undertale', label: 'Undertale', category: 'RPG', fragment: 'style of undertale, simple charming pixel art' },
  // Platformer
  { id: 'owlboy', label: 'Owlboy', category: 'Platformer', fragment: 'style of owlboy pixel art, lush detailed' },
  { id: 'celeste', label: 'Celeste', category: 'Platformer', fragment: 'style of celeste, clean modern pixel art' },
  { id: 'shovelknight', label: 'Shovel Knight', category: 'Platformer', fragment: 'style of shovel knight, NES-authentic pixel art' },
  // Cozy / Sim
  { id: 'stardew', label: 'Stardew Valley', category: 'Cozy', fragment: 'style of stardew valley, cozy warm pixel art' },
  { id: 'terraria', label: 'Terraria', category: 'Cozy', fragment: 'style of terraria, colorful sandbox pixel art' },
  { id: 'pokemon', label: 'Pokemon R/B', category: 'Cozy', fragment: 'style of pokemon red blue, game boy pixel art' },
  // Sci-Fi
  { id: 'metroid', label: 'Metroid', category: 'Sci-Fi', fragment: 'style of metroid NES, dark sci-fi pixel art' },
  { id: 'cyberpunk', label: 'Cyberpunk', category: 'Sci-Fi', fragment: 'cyberpunk pixel art, neon lights, dark city, rain' },
  // None
  { id: 'none', label: 'No Style Ref', category: 'General', fragment: '' },
];

export const assetTypes = [
  {
    id: 'background',
    label: 'Background',
    desc: 'Levels, scenery, environments',
    prefix: 'clean pixel art',
    suffix: '',
    ar: '16:9',
  },
  {
    id: 'sprite',
    label: 'Character Sprite',
    desc: 'Heroes, NPCs, playable characters',
    prefix: 'pixel art character sprite',
    suffix: 'white background',
    ar: '1:1',
  },
  {
    id: 'enemy',
    label: 'Enemy / Boss',
    desc: 'Monsters, bosses, hostile NPCs',
    prefix: 'pixel art enemy sprite',
    suffix: 'white background',
    ar: '1:1',
  },
  {
    id: 'tileset',
    label: 'Tileset',
    desc: 'Walls, floors, platforms, doors',
    prefix: 'pixel art tileset, seamless',
    suffix: 'organized grid',
    ar: '1:1',
  },
  {
    id: 'item',
    label: 'Items / Icons',
    desc: 'Weapons, potions, keys, loot',
    prefix: 'pixel art item icons',
    suffix: 'black background, arranged in grid',
    ar: '1:1',
  },
  {
    id: 'ui',
    label: 'UI Elements',
    desc: 'Health bars, menus, HUD',
    prefix: 'pixel art game UI elements',
    suffix: 'dark background',
    ar: '16:9',
  },
  {
    id: 'portrait',
    label: 'Portrait',
    desc: 'Dialogue art, character faces',
    prefix: 'pixel art character portrait, close-up face',
    suffix: '',
    ar: '3:4',
  },
  {
    id: 'splash',
    label: 'Splash / Title',
    desc: 'Title screens, loading art',
    prefix: 'pixel art title screen',
    suffix: '',
    ar: '16:9',
  },
  {
    id: 'prop',
    label: 'Props / Objects',
    desc: 'Chests, barrels, trees, furniture',
    prefix: 'pixel art game props',
    suffix: 'white background, grid layout',
    ar: '1:1',
  },
];

export const viewAngles = [
  { id: 'default', label: 'Auto' },
  { id: 'top-down', label: 'Top-Down' },
  { id: 'side-view', label: 'Side View' },
  { id: 'isometric', label: 'Isometric' },
  { id: 'front-facing', label: 'Front Facing' },
];

export const qualityMods = [
  { id: 'clean', label: 'Clean', fragment: 'clean' },
  { id: 'detailed', label: 'Detailed', fragment: 'detailed' },
  { id: 'pixel-perfect', label: 'Pixel Perfect', fragment: 'pixel perfect' },
  { id: 'dithering', label: 'Dithering', fragment: 'dithering' },
  { id: 'limited-palette', label: 'Limited Palette', fragment: 'limited color palette' },
  { id: 'no-aa', label: 'No Anti-Alias', fragment: 'no anti-aliasing' },
];

/**
 * Build a complete Midjourney prompt from selections.
 */
export function buildPixelArtPrompt({ subject, bitDepth, style, assetType, viewAngle, quality }) {
  const depth = bitDepths.find((b) => b.id === bitDepth) || bitDepths[1];
  const stylePreset = stylePresets.find((s) => s.id === style);
  const asset = assetTypes.find((a) => a.id === assetType) || assetTypes[0];

  const parts = [];

  // Quality prefix
  if (quality && quality.length > 0) {
    const qualParts = quality.map((qid) => qualityMods.find((q) => q.id === qid)?.fragment).filter(Boolean);
    if (qualParts.length) parts.push(qualParts.join(' ') + ' pixel art');
    else parts.push(asset.prefix);
  } else {
    parts.push(asset.prefix);
  }

  // Subject
  if (subject.trim()) parts.push(subject.trim());

  // Style fragment
  if (stylePreset && stylePreset.id !== 'none' && stylePreset.fragment) {
    parts.push(stylePreset.fragment);
  }

  // Bit-depth modifier
  parts.push(depth.modifier);

  // View angle
  if (viewAngle && viewAngle !== 'default') {
    parts.push(viewAngle.replace('-', ' '));
  }

  // Asset suffix (white background, grid, etc.)
  if (asset.suffix) parts.push(asset.suffix);

  // Build final prompt
  const prompt = parts.join(', ') + ` --ar ${asset.ar} --v 4`;

  return {
    prompt,
    bitDepth: depth,
    asset,
    style: stylePreset,
  };
}
