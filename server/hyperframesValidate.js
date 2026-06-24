// server/hyperframesValidate.js — request validation for the Hyperframes
// overlay-caption endpoint (ESM, vitest-covered). lower-third accepts a
// dedicated `lowerName` (person name) OR the legacy `name` field.
export function validateHyperframesRequest(body) {
  const effect = body.effect || 'hook-caption';
  switch (effect) {
    case 'hook-caption':
    case 'highlight-sweep':
      if (!body.caption) return 'caption required';
      if (effect === 'highlight-sweep' && !body.targetWord) return 'targetWord required for highlight-sweep';
      return null;
    case 'title-card':
      if (!body.title) return 'title required for title-card';
      return null;
    case 'lower-third':
      if (!body.lowerName && !body.name) return 'name required for lower-third';
      return null;
    case 'burst-lines':
      return null;
    default:
      return `unknown effect: ${effect}`;
  }
}
