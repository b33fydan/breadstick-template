export const SF_MODE_LABELS = {
  'world-build': 'World Build',
  'hero-card': 'Hero Card',
  'asset-gallery': 'Asset Gallery',
};

export const SF_DEFAULT_PARTY = ['knight in plate armor', 'cat-eared mage in robe', 'red-cap rogue', 'archer-ranger'];
export const SF_DEFAULT_STATS = [
  { label: 'STR', color: 'red' },
  { label: 'DEX', color: 'blue' },
  { label: 'VIT', color: 'yellow' },
  { label: 'INT', color: 'green' },
  { label: 'LUK', color: 'purple' },
];
export const SF_DEFAULT_SIDEBAR = [
  { label: 'HP', icon: 'heart' },
  { label: 'DEF', icon: 'shield' },
  { label: 'MAG', icon: 'star' },
  { label: 'SPD', icon: 'leaf' },
];
export const SF_DEFAULT_ACTIONS = [
  { label: 'FIGHT', icon: 'sword' },
  { label: 'DEFEND', icon: 'shield' },
  { label: 'ITEM', icon: 'potion' },
  { label: 'EXPLORE', icon: 'chest' },
];
export const SF_DEFAULT_BANDS = [
  { name: 'TERRAIN TILES', items: '' },
  { name: 'FENCES & BORDERS', items: '' },
  { name: 'VEGETATION', items: '' },
  { name: 'LIGHTING & SIGNS', items: '' },
  { name: 'WATER FEATURES & UTILITIES', items: '' },
  { name: 'DECORATIVE PROPS', items: '' },
  { name: 'BUILDINGS & STRUCTURES', items: '' },
];

export const SF_AR_OPTIONS = {
  'nano-banana-pro': ['1:1', '9:16', '16:9', '3:4', '4:3', '2:3', '3:2'],
  'image-2': ['1:1', '9:16', '16:9', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'],
};

function sfAestheticBlock(mode, palette) {
  const base = [
    '16-gami style: hyper-realistic 16-bit pixel art fused with origami / papercraft folds',
    'Tangible paper-fiber texture on every surface; stair-stepped pixel geometry with visible micro-folds at edges',
    'Pure white #FFFFFF background outside the composition; soft drop shadows directly beneath every layered element',
  ];
  if (palette && palette.trim()) base.push(`Color palette priority: ${palette.trim()}`);
  if (mode === 'world-build') base.push('Soft warm daylight from upper-left; clean shadows beneath each voxel layer');
  if (mode === 'hero-card') base.push('Vintage 1988 JRPG promo-poster framing — chunky pixel typography, parchment grid-paper backdrop, hand-trimmed paper panel edges');
  if (mode === 'asset-gallery') base.push('Each asset isolated against white with hard separation shadow so cells can be PNG-extracted independently');
  return base;
}

function sfTechBlock(mode, ar) {
  const base = [
    `Target aspect ratio: ${ar}`,
    'Pixel grid stays visible on close inspection but reads as papercraft from normal viewing distance',
    'decomposition_readiness: keep crisp dark shadow gaps between every panel and layer so individual elements can be PNG-extracted later',
  ];
  if (mode === 'hero-card') base.push("Critical fusion rule: hero and party sprites stay authentic pixel art; every panel framing them stays papercraft — don't blur the two");
  if (mode === 'asset-gallery') base.push('Equal vertical rhythm between bands; consistent ground plane within each cell');
  return base;
}

export function buildWorldBuildPrompt({ theme, tone, centerpiece, palette, appTitle, ar }) {
  const composition = [];
  const themeClean = (theme || '').trim();
  composition.push(`Voxel-builder app mockup, three-quarter isometric view of a small diorama centered on the canvas${themeClean ? `. Theme: ${themeClean}` : ''}`);
  if (centerpiece && centerpiece.trim()) composition.push(`Diorama centerpiece: ${centerpiece.trim()}`);
  if (tone && tone.trim()) composition.push(`Tonal direction: ${tone.trim()}`);
  composition.push('Left vertical toolbar: rounded white pill with seven icon+label rows — Place, Paint, Erase, Select, Pan, Orbit, Zoom; topmost icon shown active');
  composition.push('Bottom asset bar: rounded white pill with five tabs (TERRAIN, NATURE, STRUCTURES, DECOR, UTILITY) and a horizontal scroll of labeled voxel tile previews');
  composition.push('Bottom-right floating panel: time-of-day slider with sun icon and time readout, three toggle rows (Ambient Occlusion / Grid / Buddies), Layers dropdown chip');
  if (appTitle && appTitle.trim()) composition.push(`Top-left card overlay: small emblem chip, bold serif title '${appTitle.trim()}', smaller gray subtitle line beneath`);
  return JSON.stringify({
    aesthetic_constraints: sfAestheticBlock('world-build', palette),
    sculpture_composition: composition,
    technical_notes: sfTechBlock('world-build', ar),
  }, null, 2);
}

export function buildHeroCardPrompt({ title, subtitle, heroDesc, stats, sidebar, party, actions, tagline1, tagline2, emblem, corner, palette, ar }) {
  const composition = [];
  composition.push('Single full-bleed portrait-orientation game poster framed by a thin double-line border with hairline corner ornaments');
  if (heroDesc && heroDesc.trim()) composition.push(`Center stage hero: ${heroDesc.trim()}`);
  if (emblem && emblem.trim()) composition.push(`Top-left badge: ${emblem.trim()}`);
  if (title && title.trim()) {
    const subPart = subtitle && subtitle.trim() ? ` with subtitle '${subtitle.trim()}'` : '';
    composition.push(`Main title in massive stacked pixel-block sans: '${title.trim()}'${subPart}`);
  }
  if (tagline1 && tagline1.trim()) composition.push(`Primary tagline in oxblood red over a short red rule: '${tagline1.trim()}'`);
  if (tagline2 && tagline2.trim()) composition.push(`Secondary tagline in smaller navy caps: '${tagline2.trim()}'`);
  const statList = (stats || []).filter(s => s.label && s.label.trim()).map(s => `${s.label.trim()} (${(s.color || 'neutral').trim()})`).join(', ');
  if (statList) composition.push(`Lower-left stat-bar block — five labeled 5-segment bars: ${statList}, each filled to a different level`);
  const sideList = (sidebar || []).filter(s => s.label && s.label.trim()).map(s => `${(s.icon || 'icon').trim()}='${s.label.trim()}'`).join(', ');
  if (sideList) composition.push(`Right sidebar stat-icon column: ${sideList}`);
  const partyList = (party || []).filter(p => p && p.trim()).map(p => p.trim()).join(', ');
  if (partyList) composition.push(`Party sprite row, four chibi pixel-art members: ${partyList}`);
  const actionList = (actions || []).filter(a => a.label && a.label.trim()).map(a => `${a.label.trim()} (${(a.icon || 'icon').trim()})`).join(', ');
  if (actionList) composition.push(`Bottom action-icon row, four square papercraft buttons: ${actionList}`);
  composition.push('Bottom-center hero button bar: large pixel-block caps reading PRESS START with subtext NEW GAME / CONTINUE / OPTIONS');
  composition.push('Bottom-left corner: 8-BIT ADVENTURE tagline with pixel d-pad icon and red+yellow start/select circular buttons');
  if (corner && corner.trim()) composition.push(`Bottom-right corner: '${corner.trim()}' stacked oxblood-red text above a small pixel-art silhouette`);
  composition.push('Bottom edge: thin cream/navy diagonal hazard-stripe band running full width');
  return JSON.stringify({
    aesthetic_constraints: sfAestheticBlock('hero-card', palette),
    sculpture_composition: composition,
    technical_notes: sfTechBlock('hero-card', ar),
  }, null, 2);
}

export function buildAssetGalleryPrompt({ theme, bands, palette, ar }) {
  const composition = [];
  composition.push('Single-page voxel-asset catalog laid out as labeled horizontal bands. Each band is a category with thin uppercase header text and a row of three-quarter isometric voxel previews; each preview centered in its own faint rounded cell with the asset name beneath in small sans-serif');
  if (theme && theme.trim()) composition.push(`Asset theme: ${theme.trim()}`);
  const populated = (bands || []).filter(b => b.name && b.name.trim() && b.items && b.items.trim());
  populated.forEach((b, i) => {
    composition.push(`Band ${i + 1} — ${b.name.trim()}: ${b.items.trim()}`);
  });
  return JSON.stringify({
    aesthetic_constraints: sfAestheticBlock('asset-gallery', palette),
    sculpture_composition: composition,
    technical_notes: sfTechBlock('asset-gallery', ar),
  }, null, 2);
}
