// src/canvas/engine/executors/nicheScript.js
/**
 * Engine executor for the niche-gen node. Mirrors onNicheGenerate's default
 * carousel path (CanvasView.jsx:15232-15277) and writes the same output
 * shape: { status, script, error }.
 *
 * NICHE_LENGTHS verbatim from CanvasView.jsx lines 2737-2742.
 * systemPrompt verbatim from CanvasView.jsx lines 15244-15261.
 */

// VERBATIM copy from CanvasView.jsx lines 2737-2742
const NICHE_LENGTHS = [
  { id: 'test', label: 'Test', slides: '1', words: '20-35' },
  { id: 'short', label: 'Short', slides: '4-6', words: '100-160' },
  { id: 'medium', label: 'Medium', slides: '8-10', words: '180-260' },
  { id: 'long', label: 'Long', slides: '12-15', words: '280-400' },
];

export const nicheScriptExecutor = {
  retryable: true, // LLM call — transient 529s happen
  async execute({ node, report, server, keys, fetchImpl = fetch }) {
    const { topic, tone = 'educational', length = 'medium', researchLive = false } = node.data || {};
    if (!topic) throw new Error('niche-gen node has no topic set');
    if (!keys.anthropic) throw new Error('Anthropic API key missing');

    report({ status: 'generating', script: '', error: '' });

    const lengthSpec = NICHE_LENGTHS.find((l) => l.id === length) || NICHE_LENGTHS[1];
    const parseRange = (s) => {
      const parts = String(s).split('-').map((p) => parseInt(p, 10));
      return { min: parts[0] || 1, max: parts[1] || parts[0] || 1 };
    };
    const slidesR = parseRange(lengthSpec.slides);
    const wordsR = parseRange(lengthSpec.words);
    const maxPerSlide = Math.max(1, Math.ceil(wordsR.max / slidesR.max));
    const researchClause = researchLive
      ? `\n- This topic may involve current events past your training cutoff. Use the web_search tool to ground every factual claim in recent, verified sources. If search returns nothing usable, say so on slide 1 and stop, do NOT invent details, names, dates, or quotes.`
      : '';

    // VERBATIM copy of systemPrompt from CanvasView.jsx lines 15244-15261
    const systemPrompt = `You are a visual storytelling scriptwriter for educational carousel content. Each script becomes a multi-slide post where every slide is paired with a generated image downstream. You write only the words; imagery is handled by a separate visual pipeline.

CRITICAL — the script is ABOUT THE TOPIC, never about the medium. Do not write about "the paper", "the fold", "origami", "cardstock", "the diorama", "layers unfolding", or any meta-reference to how the visual will be rendered. The protagonist or subject is whatever the topic dictates — a person, a system, an idea, a concept — never paper or a fold. Treat the visual style as invisible to the reader.

HARD LENGTH BUDGET — these limits are non-negotiable and override every other instruction including tone:
- TOTAL: ${wordsR.max} words MAX across the entire script. Going over breaks the carousel layout.
- SLIDES: ${lengthSpec.slides} numbered slides, no more.
- PER SLIDE: ${maxPerSlide} words MAX per slide. 1-2 sentences typical, 3 only when essential.
- The tone (${tone}) controls voice, pacing, and word choice. It does NOT add words. Educational, Dramatic, Inspirational, Analytical, and Narrative all share the exact same length budget.

Style:
- Numbered slides, one concept per slide
- Vivid, visual language that translates well to imagery WITHOUT naming the medium
- Slide 1 must be a scroll-stopping hook
- Final slide is a clear takeaway or call to reflection
- NEVER use em dashes (—) or en dashes (–). Use commas, periods, colons, or hyphens (-) instead. The downstream renderer cannot display them.${researchClause}

Output ONLY the script text. Each slide on its own line, prefixed with the slide number. No metadata, no commentary, no source citations in the body.`;

    const userPrompt = `Write a ${tone} visual storytelling script about: ${topic}`;

    const res = await fetchImpl(`${server}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: keys.anthropic, model: keys.model,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        webSearch: !!researchLive,
      }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) throw new Error('Empty script returned');
    return { status: 'done', script: text, error: '' };
  },
};
