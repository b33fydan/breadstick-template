import { useCallback, useMemo, useState } from 'react';
import { buildSystemPrompt, buildUserPrompt, buildProductionPrompts, buildClipboardPrompt } from '../data/scriptPrompts';

/**
 * Resolves React Flow edges + nodes into pipeline state.
 * Bridges the canvas world to the existing data functions.
 */
export function useCanvasPipeline(nodes, edges, apiKey, model) {
  const [script, setScript] = useState('');
  const [productionPrompts, setProductionPrompts] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState(null);

  // Find the ScriptGenerator node
  const generatorNode = useMemo(() => nodes.find((n) => n.type === 'scriptGenerator'), [nodes]);
  const generatorId = generatorNode?.id;

  // Resolve what's connected to the generator
  const resolved = useMemo(() => {
    if (!generatorId) return null;

    const incomingEdges = edges.filter((e) => e.target === generatorId);
    let character = null;
    let painPointIndex = null;
    let hookIndex = null;
    let scriptTypeId = null;
    let conversionId = null;

    for (const edge of incomingEdges) {
      const sourceNode = nodes.find((n) => n.id === edge.source);
      if (!sourceNode) continue;

      if (edge.targetHandle === 'painpoint-in' && sourceNode.type === 'painPoint') {
        painPointIndex = sourceNode.data.index;
        // Trace back to find the character this pain point belongs to
        const charEdge = edges.find((e) => e.target === sourceNode.id && e.targetHandle === 'character-in');
        if (charEdge) {
          const charNode = nodes.find((n) => n.id === charEdge.source);
          if (charNode?.type === 'character') character = charNode.data.character;
        }
      }

      if (edge.targetHandle === 'hook-in' && sourceNode.type === 'hook') {
        hookIndex = sourceNode.data.index;
        if (!character) {
          const charEdge = edges.find((e) => e.target === sourceNode.id && e.targetHandle === 'character-in');
          if (charEdge) {
            const charNode = nodes.find((n) => n.id === charEdge.source);
            if (charNode?.type === 'character') character = charNode.data.character;
          }
        }
      }

      if (edge.targetHandle === 'scripttype-in' && sourceNode.type === 'scriptType') {
        scriptTypeId = sourceNode.data.scriptType?.id;
      }

      if (edge.targetHandle === 'conversion-in' && sourceNode.type === 'conversionLevel') {
        conversionId = sourceNode.data.level?.id;
      }
    }

    const selections = {
      painPoint: painPointIndex,
      hook: hookIndex,
      scriptType: scriptTypeId,
      conversionLevel: conversionId,
      trigger: null,
      ctaMechanism: null,
    };

    const connectedCount = [painPointIndex, hookIndex, scriptTypeId, conversionId]
      .filter((v) => v !== null && v !== undefined).length;

    return { character, selections, connectedCount };
  }, [generatorId, nodes, edges]);

  const canGenerate = resolved?.connectedCount === 4 && resolved.character && apiKey;

  const generate = useCallback(async () => {
    if (!canGenerate || !resolved) return;
    setIsGenerating(true);
    setError(null);

    const { character, selections } = resolved;
    const systemPrompt = buildSystemPrompt(character, selections);
    const userPrompt = buildUserPrompt(character, selections);

    try {
      const res = await fetch('http://localhost:3001/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey,
          model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API error ${res.status}`);
      }

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      setScript(text);

      const prompts = buildProductionPrompts(character, selections, text);
      setProductionPrompts(prompts);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }, [canGenerate, resolved, apiKey, model]);

  const copyPrompt = useCallback(async () => {
    if (!resolved?.character || resolved.connectedCount < 4) return;
    const text = buildClipboardPrompt(resolved.character, resolved.selections);
    await navigator.clipboard.writeText(text).catch(() => {});
  }, [resolved]);

  return {
    resolved,
    canGenerate,
    script,
    productionPrompts,
    isGenerating,
    error,
    generate,
    copyPrompt,
  };
}
