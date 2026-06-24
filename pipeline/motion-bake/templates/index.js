// Motion Bake template registry. The server endpoint imports this and the
// canvas reads it (via the API) to populate the per-beat dropdown.
//
// Adding a new template: drop a new file alongside this one and register it
// here. Each module must default-export { id, label, description, fields,
// defaults: {width, height, durationSec}, render(opts) }.

import terminal   from './terminal.js';
import lowerThird from './lower-third.js';
import callout    from './callout.js';
import codeReveal from './code-reveal.js';
import statSlam   from './stat-slam.js';

export const TEMPLATES = {
  terminal,
  'lower-third': lowerThird,
  callout,
  'code-reveal': codeReveal,
  'stat-slam':   statSlam,
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

// Compact catalog for prompting the LLM and rendering the canvas dropdown.
// Trims defaults + render fn so the list stays small in API responses.
export const TEMPLATE_CATALOG = TEMPLATE_LIST.map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  fields: t.fields,
}));
