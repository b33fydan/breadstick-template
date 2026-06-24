import { useState, useMemo } from 'react';
import {
  loadAllRecipes,
  saveRecipe,
  deleteRecipe,
  newRecipeId,
  RECIPE_STATUSES,
  SEED_RECIPES,
} from '../data/recipes';
import { buildRecipeAuthorSystemPrompt, buildRecipeAuthorUserPrompt } from '../data/scriptPrompts';

const SEED_IDS = new Set(SEED_RECIPES.map(r => r.id));

export default function RecipesPanel({ character, apiKey, model, onUseRecipe }) {
  const accent = character.accentColor;
  const [allRecipes, setAllRecipes] = useState(() => loadAllRecipes());
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftOpen, setDraftOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [draftPainIdx, setDraftPainIdx] = useState(0);
  const [draftHookIdx, setDraftHookIdx] = useState(0);
  const [draftCtaLabel, setDraftCtaLabel] = useState('');

  const recipes = useMemo(
    () => allRecipes.filter(r => r.character === character.id),
    [allRecipes, character.id],
  );

  const refresh = () => setAllRecipes(loadAllRecipes());

  const handleStatusChange = (recipe, newStatus) => {
    const updated = { ...recipe, status: newStatus };
    saveRecipe(updated);
    refresh();
  };

  const handleNotesChange = (recipe, notes) => {
    const updated = { ...recipe, notes };
    saveRecipe(updated);
    refresh();
  };

  const handleDelete = (recipe) => {
    if (SEED_IDS.has(recipe.id)) return;
    if (!confirm(`Delete recipe "${recipe.title}"? This can't be undone.`)) return;
    deleteRecipe(recipe.id);
    refresh();
    if (expandedId === recipe.id) setExpandedId(null);
  };

  const handleDraft = async () => {
    if (!apiKey) {
      setDraftError('Add an API key first');
      return;
    }
    const painLabel = character.painPoints[draftPainIdx];
    const hookLabel = character.hooks[draftHookIdx];
    const ctaLabel = draftCtaLabel || character.ctaStyle;

    setDrafting(true);
    setDraftError('');

    try {
      const system = buildRecipeAuthorSystemPrompt(character);
      const user = buildRecipeAuthorUserPrompt(character, painLabel, hookLabel, ctaLabel);
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model: model || 'claude-sonnet-4-6',
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `API ${res.status}`);
      const fullScript = (data.content?.[0]?.text || '').trim();
      if (!fullScript) throw new Error('Empty response');

      const titleGuess = hookLabel.split(/[.!?]/)[0].slice(0, 60).trim();
      const newRecipe = {
        id: newRecipeId(character.id),
        character: character.id,
        title: titleGuess || 'Untitled draft',
        painLabel,
        hookLabel,
        ctaLabel,
        fullScript,
        status: 'drafting',
        notes: 'LLM-drafted. Review for voice, continuity, 12-word sentences before recording.',
        createdAt: new Date().toISOString().slice(0, 10),
      };
      saveRecipe(newRecipe);
      refresh();
      setExpandedId(newRecipe.id);
      setDraftOpen(false);
    } catch (err) {
      setDraftError(err.message);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <section className="recipes-panel" style={{ '--accent': accent }}>
      <div className="recipes-header">
        <div>
          <h3>Recipes</h3>
          <span className="recipes-hint">
            One coherent ~60s script, authored as a single piece. Don't recombine ingredients across recipes.
          </span>
        </div>
        <button
          className="recipes-draft-btn"
          onClick={() => setDraftOpen(v => !v)}
        >
          {draftOpen ? 'Cancel' : '+ Draft new recipe'}
        </button>
      </div>

      {draftOpen && (
        <div className="recipes-draft-form">
          <div className="recipes-draft-row">
            <label>Pain</label>
            <select value={draftPainIdx} onChange={(e) => setDraftPainIdx(+e.target.value)}>
              {character.painPoints.map((pp, i) => (
                <option key={i} value={i}>{pp}</option>
              ))}
            </select>
          </div>
          <div className="recipes-draft-row">
            <label>Hook</label>
            <select value={draftHookIdx} onChange={(e) => setDraftHookIdx(+e.target.value)}>
              {character.hooks.map((h, i) => (
                <option key={i} value={i}>{h}</option>
              ))}
            </select>
          </div>
          <div className="recipes-draft-row">
            <label>CTA</label>
            <input
              type="text"
              placeholder={`Default: ${character.ctaStyle?.slice(0, 60) || 'character ctaStyle'}...`}
              value={draftCtaLabel}
              onChange={(e) => setDraftCtaLabel(e.target.value)}
            />
          </div>
          {draftError && <div className="recipes-draft-error">{draftError}</div>}
          <div className="recipes-draft-actions">
            <button
              className="recipes-draft-go"
              onClick={handleDraft}
              disabled={drafting}
            >
              {drafting ? 'Drafting...' : 'Draft (one coherent monologue)'}
            </button>
          </div>
        </div>
      )}

      {recipes.length === 0 && !draftOpen && (
        <div className="recipes-empty">
          No recipes yet for {character.name}. Click "Draft new recipe" to start, or hand-author one in <code>src/data/recipes.js</code>.
        </div>
      )}

      <div className="recipes-list">
        {recipes.map(recipe => {
          const isOpen = expandedId === recipe.id;
          const isEditing = editingId === recipe.id;
          const status = RECIPE_STATUSES.find(s => s.id === recipe.status) || RECIPE_STATUSES[0];
          return (
            <div key={recipe.id} className={`recipe-card${isOpen ? ' open' : ''}`}>
              <div className="recipe-card-row" onClick={() => setExpandedId(isOpen ? null : recipe.id)}>
                <div className="recipe-card-main">
                  <div className="recipe-card-title-row">
                    <span className="recipe-card-id">{recipe.id}</span>
                    <span className="recipe-card-title">{recipe.title}</span>
                  </div>
                  <div className="recipe-card-meta">
                    <span className="recipe-meta-pain">P: {recipe.painLabel?.slice(0, 50)}{recipe.painLabel?.length > 50 ? '…' : ''}</span>
                    <span className="recipe-meta-hook">H: {recipe.hookLabel?.slice(0, 50)}{recipe.hookLabel?.length > 50 ? '…' : ''}</span>
                  </div>
                </div>
                <div className="recipe-card-side">
                  <span
                    className="recipe-status-badge"
                    style={{ '--badge': status.color }}
                  >
                    {status.label}
                  </span>
                </div>
              </div>

              {isOpen && (
                <div className="recipe-card-body">
                  <pre className="recipe-script-preview">{recipe.fullScript}</pre>

                  <div className="recipe-card-controls">
                    <select
                      value={recipe.status}
                      onChange={(e) => handleStatusChange(recipe, e.target.value)}
                      className="recipe-status-select"
                    >
                      {RECIPE_STATUSES.map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>

                    <button
                      className="recipe-use-btn"
                      onClick={() => onUseRecipe(recipe)}
                    >
                      Use this recipe →
                    </button>

                    {!SEED_IDS.has(recipe.id) && (
                      <button
                        className="recipe-delete-btn"
                        onClick={() => handleDelete(recipe)}
                        title="Delete recipe"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  <div className="recipe-notes-block">
                    <label>Notes</label>
                    {isEditing ? (
                      <textarea
                        defaultValue={recipe.notes}
                        rows={3}
                        onBlur={(e) => {
                          handleNotesChange(recipe, e.target.value);
                          setEditingId(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <div
                        className="recipe-notes-display"
                        onClick={() => setEditingId(recipe.id)}
                      >
                        {recipe.notes || <span className="recipe-notes-empty">click to add notes…</span>}
                      </div>
                    )}
                  </div>

                  <div className="recipe-card-footer">
                    <span>CTA: {recipe.ctaLabel}</span>
                    <span>·</span>
                    <span>{recipe.createdAt}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
