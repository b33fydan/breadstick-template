import { useState, useCallback } from 'react';
import { buildSystemPrompt, buildUserPrompt, buildProductionPrompts } from '../data/scriptPrompts';

const API_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];

export function useScriptGenerator() {
  const [script, setScript] = useState(null);
  const [productionPrompts, setProductionPrompts] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  const generate = useCallback(async (character, selections, apiKey, model) => {
    setIsGenerating(true);
    setError(null);
    setScript(null);
    setProductionPrompts(null);

    try {
      const systemPrompt = buildSystemPrompt(character, selections);
      const userPrompt = buildUserPrompt(character, selections);

      const response = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model: model || API_MODELS[0],
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const scriptText = data.content?.[0]?.text || '';

      setScript(scriptText);

      // Extract just the spoken script for production prompts
      const cleanScript = extractSpokenScript(scriptText);
      const prompts = buildProductionPrompts(character, selections, cleanScript);
      setProductionPrompts(prompts);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setScript(null);
    setProductionPrompts(null);
    setError(null);
  }, []);

  // Load a pre-authored recipe directly into the script slot. No LLM call —
  // the recipe IS the finished script. Production prompts cleared (recipes
  // don't ship per-ingredient briefs; the script itself is the final artifact).
  const loadRecipe = useCallback((recipe) => {
    setScript(recipe.fullScript);
    setProductionPrompts(null);
    setError(null);
  }, []);

  return { script, productionPrompts, isGenerating, error, generate, reset, loadRecipe };
}

// Extract just the spoken words from the formatted script
function extractSpokenScript(fullScript) {
  const lines = fullScript.split('\n');
  const spoken = [];
  let inScript = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip metadata lines
    if (trimmed.startsWith('[SCRIPT TYPE') || trimmed.startsWith('[LENGTH') ||
        trimmed.startsWith('[LIFE-FORCE') || trimmed.startsWith('[CONVERSION')) {
      continue;
    }

    // Skip section headers but mark we're in content
    if (trimmed.startsWith('[HOOK') || trimmed.startsWith('[BODY') ||
        trimmed.startsWith('[CLOSE')) {
      inScript = true;
      continue;
    }

    // Skip NOTES section
    if (trimmed.startsWith('NOTES:') || trimmed.startsWith('---')) {
      inScript = false;
      continue;
    }

    if (trimmed.startsWith('- ')) continue;
    if (trimmed.startsWith('```')) continue;

    if (trimmed && inScript) {
      spoken.push(trimmed);
    }
  }

  return spoken.join('\n');
}

export { API_MODELS };
