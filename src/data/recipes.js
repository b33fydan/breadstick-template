// Breadstick — Recipes
//
// A Recipe is ONE coherent ~60s script. The Pain/Hook/CTA labels describe
// what's in it for performance tracking — they are NOT fragments to recombine.
//
// If a recipe flops, retire it and write a new whole recipe. Don't swap its
// hook with another recipe's CTA — that's how you get hard cuts and broken flow.
//
// Storage: this file ships SEED recipes (hand-authored). User-created or
// edited recipes are persisted to localStorage under `breadstick.recipes`
// and merged on load. See src/components/RecipesPanel.jsx for the read/write
// helpers.

export const SEED_RECIPES = [
  {
    id: 'mia-001',
    character: 'mia-chen',
    title: 'Two Weeks In — The Honest Skin Update',
    painLabel: '"I can never tell if a product actually works or if it is just good marketing"',
    hookLabel: 'Skeptical-then-convinced → show the skin',
    ctaLabel: 'Soft link-in-bio endorsement',
    fullScript: `Okay so I have been using this for two weeks.
And I need to talk about it.
Someone recommended it and honestly I was skeptical.
I have tried everything, so I get it.

But look at my skin right now.
No foundation. No filter. Just this.
The texture is the part nobody mentions.
My pores actually look smaller in the morning.

Here is what changed for me.
I stopped layering ten things at once.
Three steps. That is the whole routine.
Cleanser, this serum, then SPF.

I am not going to call it magic.
It took the full two weeks to settle.
But I keep reaching for it.
And my skin stopped freaking out.

If you want to try it, link is in bio.
No pressure — just sharing what worked for me.`,
    status: 'untested',
    notes: 'Example seed recipe (demo character Mia Chen). ~140 words, ≤12 words per sentence, antecedent-clean. Shows the skeptic-hook + specificity-proof + soft-bridge CTA structure for UGC. Replace with your own roster recipes.',
    createdAt: '2026-06-23',
  },
];

// Status taxonomy
export const RECIPE_STATUSES = [
  { id: 'untested',  label: 'Untested',  color: '#888' },
  { id: 'drafting',  label: 'Drafting',  color: '#f4a261' },
  { id: 'recorded',  label: 'Recorded',  color: '#5588ff' },
  { id: 'posted',    label: 'Posted',    color: '#5fd1b8' },
  { id: 'winner',    label: 'Winner',    color: '#27c93f' },
  { id: 'dud',       label: 'Dud',       color: '#e74c3c' },
];

const STORAGE_KEY = 'breadstick.recipes';

export function loadAllRecipes() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const seedIds = new Set(SEED_RECIPES.map(r => r.id));
    // User-stored entries take precedence over seed (allows editing seed status/notes)
    const overrides = new Map(stored.filter(r => seedIds.has(r.id)).map(r => [r.id, r]));
    const userOnly = stored.filter(r => !seedIds.has(r.id));
    const merged = SEED_RECIPES.map(s => overrides.get(s.id) || s).concat(userOnly);
    return merged;
  } catch {
    return [...SEED_RECIPES];
  }
}

export function saveRecipe(recipe) {
  const all = loadAllRecipes();
  const idx = all.findIndex(r => r.id === recipe.id);
  const next = idx === -1 ? [...all, recipe] : all.map(r => r.id === recipe.id ? recipe : r);
  // Strip seed entries that haven't been edited (keep storage tight)
  const seedIds = new Set(SEED_RECIPES.map(r => r.id));
  const seedById = new Map(SEED_RECIPES.map(r => [r.id, r]));
  const toStore = next.filter(r => {
    if (!seedIds.has(r.id)) return true;
    const seed = seedById.get(r.id);
    return JSON.stringify(r) !== JSON.stringify(seed);
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  return next;
}

export function deleteRecipe(recipeId) {
  const all = loadAllRecipes();
  // Seeds can't be hard-deleted — they live in code. Users can mark them 'dud'.
  if (SEED_RECIPES.some(s => s.id === recipeId)) return all;
  const next = all.filter(r => r.id !== recipeId);
  const seedIds = new Set(SEED_RECIPES.map(r => r.id));
  const seedById = new Map(SEED_RECIPES.map(r => [r.id, r]));
  const toStore = next.filter(r => {
    if (!seedIds.has(r.id)) return true;
    const seed = seedById.get(r.id);
    return JSON.stringify(r) !== JSON.stringify(seed);
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  return next;
}

export function newRecipeId(characterId) {
  const all = loadAllRecipes();
  const prefix = characterId.split('-')[0];
  let n = 1;
  while (all.some(r => r.id === `${prefix}-${String(n).padStart(3, '0')}`)) n++;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
