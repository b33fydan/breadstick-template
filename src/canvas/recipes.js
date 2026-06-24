// ─── Canvas Recipes Registry ──────────────────────────────────────────────
// A Recipe = a locked, reproducible canvas wiring pattern + diagram + Skill.
// Operators pick a Recipe from the top-center dropdown → the diagram appears
// as a labeled panel on the canvas → operator follows the wiring manually
// (or invokes the Skill via Claude for automated runs).
//
// Recipes graduate from this registry when:
//   1. A test run has been locked end-to-end (operator-signed)
//   2. A definitive Skill markdown exists for reproducible execution
//   3. The wiring has been used 5+ times OR is canonical for a content lane
//
// Distinct from script-Recipes (data/recipes.js) — those are monologue
// assemblies. Canvas-Recipes are workflow patterns.

export const RECIPES = [
  {
    id: 'cybersec-truth-bomb',
    name: 'Cybersec Truth Bomb',
    category: 'Skyframe Shortform',
    description:
      'Ray-Ban POV overlay for AI/security threat reels. 5-beat Skyframe template with cybersec anchor conventions: RayBanIntro hook → KaraokeCard threat actor → KaraokeCard pain bullets → Win95Terminal /audit payoff → AsciiPlanet tail → OpusGlisten chime on the last spoken word.',
    skillFile: 'skills/breadstick-cybersec-truth-bomb/SKILL.md',
    canonicalComposition: 'src/remotion/compositions/PracticeOverlay010.jsx',
    canonicalSource: 'testing-vids/cartesiantest001.mp4',
    lockedAt: '2026-05-12',
    triggerPhrases: [
      'cybersec truth bomb on this video',
      'wire the cybersec POV overlay',
      'apply the AI security recipe',
    ],
    diagram: `┌──────────────────────────────────────────────┐
│  SOURCE                                       │
│  Ray-Ban POV mp4 (≥1080×1920, 30fps)          │
│  Drive or local: testing-vids/<name>.mp4      │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  TRANSCRIBE  (ElevenLabs Scribe)              │
│  testing-vids/edit/transcripts/<name>.json    │
│  → word-level timestamps                      │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITION  (Remotion, copy of P.O.010)     │
│                                               │
│  Beat 1  HOOK      0–2.0s   RayBanIntro       │
│  Beat 2  THREAT    7–14s    KaraokeCard ←─┐   │
│  Beat 3  BULLETS  15.5–23s  KaraokeCard ←─┤ × │
│  Beat 4  PIVOT   23.5–27.5s Win95Terminal ┘   │
│  Tail    DECOR    30–35s    AsciiPlanet       │
│  Beat 5  CTA      34–37s    OpusGlisten       │
│                                               │
│  AUDIO  bubbles ×4, NO whoosh, chime ×1       │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  RENDER OVERLAY  (Remotion → VP9 webm)        │
│  --codec=vp9 --pixel-format=yuva420p          │
│  → testing-vids/edit/overlays/<name>.webm     │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITE  (FFmpeg single pass)              │
│  scale 1080×1920 + lut3d (LUT #20)            │
│  + gblur 0–2s + overlay (VP9 alpha rule)      │
│  + audio mix (src 1.0 + cues 0.8)             │
│  → testing-vids/edit/<name>_truth_bomb.mp4    │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  UPLOAD  →  Google Drive                      │
│  gws drive +upload <output>.mp4               │
└──────────────────────────────────────────────┘`,
    locks: [
      'RayBanIntro: 2.0s window (not 3s)',
      'FFmpeg gblur 0–2s enabled on base footage',
      'Win95Terminal: 1s linger past typing completion',
      'OpusGlisten: fontSize=194, caretHeight=146 (90% of length-tier default)',
      'OpusGlisten anchors on the LAST spoken word (not the truth-bomb hero)',
      'NO whoosh sounds (locked out for cybersec dialog density)',
      'Audio: 4 bubbles + 1 chime exactly',
      'LUT: pipeline/luts/default.cube (copy to .tmp/lut20.cube to avoid shell/filtergraph path issues)',
    ],
    scriptShape: `Write a ~35-second cybersec-of-AI POV reel script for a Ray-Ban POV recording.

STRUCTURE (must follow exactly):
1. HOOK (~17 words, 0–7s): "You're [verb] [AI surface] you don't [understand/audit/verify]. That's a problem."
2. THREAT (~17 words, 7–14s): How attackers exploit this gap. Build to a punchy phrase ending in "...and attackers love that." (or near-equivalent).
3. THREE PAIN BULLETS (~22 words, 14–23s): Exactly three specific vulnerabilities, listed one after another. Sentence structure: "AI won't warn you about [bullet 1], [bullet 2], or [bullet 3]." Each bullet ≤4 words.
4. PIVOT (~5 words, 23–25s): A pattern interrupt like "Here's the thing." or "But here's the truth."
5. TRUTH BOMB (~10 words, 25–29s): One declarative sentence using a security primitive (attack surface, blast radius, trust boundary, kill chain, lateral move).
6. CTA (~20 words, 29–36s): "Follow me [if/for] stay ahead with [domain]." End on a replay-worthy single word that ties back to the cybersec lane.

NEVER use em dashes (—) or en dashes (–). Output ONLY the spoken script as a single paragraph — no slide numbers, no metadata, no annotations. Total ≈90 words.`,
  },
  {
    id: 'build-day-diary',
    name: 'Build-Day Diary',
    category: 'Skyframe Shortform',
    description:
      '"I shipped X today" — terminal-heavy builder content. RayBanIntro hook → LowerThirdChyron names the tool → CompactCard /command → Win95Terminal output → AsciiPlanet tail → OpusGlisten on the impact word. Celebratory vibe, not threat-reveal.',
    skillFile: 'skills/breadstick-build-day-diary/SKILL.md',
    canonicalComposition: 'src/remotion/compositions/PracticeOverlay012.jsx',
    canonicalSource: 'DRAFT — awaiting first build-day recording for lock-pass',
    lockedAt: '2026-05-12 (DRAFT)',
    triggerPhrases: [
      'build-day diary recipe',
      'wire the build-day overlay',
      'I shipped X today reel',
    ],
    diagram: `┌──────────────────────────────────────────────┐
│  SOURCE                                       │
│  Ray-Ban POV or desk-cam mp4 (≥1080×1920)     │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITION  (PracticeOverlay012 template)   │
│                                               │
│  Beat 1  HOOK      0–2.0s   RayBanIntro       │
│  Beat 2  NAMING    5–12s    LowerThirdChyron  │ ◀ NEW MG
│  Beat 3  COMMAND  13–20s    CompactCard       │
│  Beat 4  OUTPUT   21–28s    Win95Terminal     │
│  Tail    DECOR    29–34s    AsciiPlanet       │
│  Beat 5  CTA      34–37s    OpusGlisten       │
│                                               │
│  AUDIO  bubbles ×4, mouse-click ×1, chime ×1  │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITE  (same single-pass ffmpeg as       │
│  Cybersec Truth Bomb — scale + lut3d + gblur  │
│  + overlay + audio mix)                       │
└──────────────────────────────────────────────┘`,
    locks: [
      'LowerThirdChyron is the signature naming moment (the new MG)',
      'mouse-click on chyron slide-in (replaces a generic bubble)',
      'NO whoosh sounds (carries cybersec doctrine)',
      'OpusGlisten anchors on the impact verb ("SHIPPED", "BUILT", "DROPPED")',
      'AsciiPlanet tail = "system / stack / pipeline" energy',
      'Use only when actually showing your terminal — not for abstract storytelling',
    ],
    scriptShape: `Write a ~35-second "I built X today" builder POV reel script for a Ray-Ban POV recording.

STRUCTURE (must follow exactly):
1. HOOK (~12 words, 0–5s): "I shipped [tool / feature] today. [one-line value claim]."
2. NAMING (~18 words, 5–12s): Briefly name what it is — proper noun for the tool, plus what category/role it sits in.
3. COMMAND DEMO (~18 words, 13–20s): Reference a specific command, workflow, or operation that demonstrates the tool ("you run /X and it does Y").
4. OUTPUT / RECEIPT (~20 words, 21–28s): Concrete proof of shipping — a number, a named artifact, a count, a milestone.
5. IMPACT (~22 words, 28–37s): Why this unlocks something for the builder lane. End on a single replay-worthy impact verb (SHIPPED, BUILT, DROPPED, WIRED, LOCKED).

Celebratory builder energy, not threat-reveal. No em dashes. Output ONLY the spoken script. Total ≈90 words.`,
  },
  {
    id: 'plan-it-out',
    name: 'Plan-It-Out',
    category: 'Skyframe Shortform',
    description:
      '"3 things to do before you X" — save-bait receipt list. RayBanIntro promise → StatCallout ×3 (numbered items) → AsciiPlanet → OpusGlisten on the save-trigger word. No terminal, no card chrome — pure stat-stack cadence. Chases the ≥20% save-rate north star.',
    skillFile: 'skills/breadstick-plan-it-out/SKILL.md',
    canonicalComposition: 'src/remotion/compositions/PracticeOverlay013.jsx',
    canonicalSource: 'DRAFT — awaiting first numbered-list recording for lock-pass',
    lockedAt: '2026-05-12 (DRAFT)',
    triggerPhrases: [
      'plan-it-out recipe',
      'numbered list overlay',
      'three things before recipe',
    ],
    diagram: `┌──────────────────────────────────────────────┐
│  SOURCE                                       │
│  Ray-Ban POV mp4 — numbered list script       │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITION  (PracticeOverlay013 template)   │
│                                               │
│  Beat 1  HOOK      0–2.0s   RayBanIntro       │
│  Beat 2  ITEM #1   5–10s    StatCallout       │ ◀ NEW MG
│  Beat 3  ITEM #2  11–16s    StatCallout       │ ◀ NEW MG
│  Beat 4  ITEM #3  17–22s    StatCallout       │ ◀ NEW MG
│  Tail    DECOR    23–27s    AsciiPlanet       │
│  Beat 5  CTA      28–31s    OpusGlisten       │
│                                               │
│  AUDIO  bubbles ×4, ticks ×6, chime2 ×3,      │
│         chime ×1                              │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITE  (single-pass ffmpeg, std recipe)  │
└──────────────────────────────────────────────┘`,
    locks: [
      'StatCallout ×3 is the load-bearing rhythm — no other Beat 2/3/4 effects allowed',
      'digital-click ticks during each count-up, chime2 on each landing',
      'NO whoosh, NO Win95, NO CompactCard, NO KaraokeCard',
      'Opus CTA word should be a save-trigger ("CHECKLIST", "PLAN", "RULES", "STEPS")',
      'Script must have exactly 3 enumerable items — 5 items overruns the comp timing',
      'AsciiPlanet tail is short (4s) — keep the receipt-stack momentum into the CTA',
    ],
    scriptShape: `Write a ~30-second "3 things to do before you X" save-bait listicle script for a Ray-Ban POV recording.

STRUCTURE (must follow exactly):
1. HOOK (~10 words, 0–4s): "3 things to do before you [verb]." Promise the save.
2. ITEM #1 (~12 words, 5–10s): First rule. Action-first sentence ("[Verb] the [thing]"). ≤12 words.
3. ITEM #2 (~12 words, 11–16s): Second rule. Same shape as #1.
4. ITEM #3 (~12 words, 17–22s): Third rule. Same shape.
5. CTA (~15 words, 28–31s): Save-trigger close ending on a SINGLE replay-worthy word (CHECKLIST, PLAN, RULES, STEPS, LIST).

EXACTLY 3 items — not 2, not 4, not 5. The rhythm is the point.
No em dashes. Output ONLY the spoken script. Total ≈65 words.`,
  },
  {
    id: 'hot-take',
    name: 'Hot Take',
    category: 'Skyframe Shortform',
    description:
      '"Everyone\'s wrong about X" — contrarian commentary. RayBanIntro frame → KaraokeCard of the wrong take → CircleHighlight wraps the wrong word → TrashCompactor compresses it (whoosh!) → Win95Terminal types the corrected take → OpusGlisten on the contrarian word. The ONE recipe where whoosh is earned.',
    skillFile: 'skills/breadstick-hot-take/SKILL.md',
    canonicalComposition: 'src/remotion/compositions/PracticeOverlay014.jsx',
    canonicalSource: 'DRAFT — awaiting first hot-take recording for lock-pass',
    lockedAt: '2026-05-12 (DRAFT)',
    triggerPhrases: [
      'hot take recipe',
      'contrarian commentary overlay',
      "everyone's wrong about reel",
    ],
    diagram: `┌──────────────────────────────────────────────┐
│  SOURCE                                       │
│  Ray-Ban POV mp4 — contrarian script          │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITION  (PracticeOverlay014 template)   │
│                                               │
│  Beat 1  HOOK         0–2.0s   RayBanIntro    │
│  Beat 2  WRONG TAKE   5–10s    KaraokeCard    │
│        (overlay) 7.5–10.5s     CircleHighlight │ ◀ NEW MG
│  Beat 3  COMPRESS    10–13s    TrashCompactor │
│  Beat 4  TRUTH       14–22s    Win95Terminal  │
│  Beat 5  CTA         24–27s    OpusGlisten    │
│                                               │
│  AUDIO  bubbles ×3, chime2 ×1 (circle),       │
│         whoosh ×1 (compactor), chime ×1       │
└──────────────────────┬───────────────────────┘
                       ▼
┌──────────────────────────────────────────────┐
│  COMPOSITE  (single-pass ffmpeg, std recipe)  │
└──────────────────────────────────────────────┘`,
    locks: [
      'CircleHighlight wraps the wrong-take hero word (the new MG) — anchored to the KaraokeCard hero position',
      'TrashCompactor is THE pattern interrupt — earns its whoosh',
      'EXACTLY ONE whoosh in this recipe (no carryover from cybersec doctrine)',
      'Win95Terminal /command should be a thinking verb ("/think", "/reframe", "/audit")',
      'Opus CTA word is the corrected truth\'s anchor word — punchier than the wrong-take word',
      'Shortest of the 4 recipes (~27s) — designed for fast contrarian punch',
    ],
    scriptShape: `Write a ~27-second contrarian commentary script for a Ray-Ban POV recording.

STRUCTURE (must follow exactly):
1. HOOK (~10 words, 0–4s): "Everyone's wrong about [topic]." Frame the contrarian premise.
2. CONVENTIONAL WISDOM (~12 words, 5–10s): State the WRONG take in 1 sentence. End on a clear noun that becomes the wrong-take anchor word.
3. PIVOT (~5 words, 10–13s): Quick dismissal — "Actually," or "Here's why," or "Wrong." Sets up the correction.
4. CORRECTED TAKE (~14 words, 14–22s): One declarative sentence delivering the contrarian truth. End on a strong replay-worthy noun.
5. CTA (~10 words, 24–27s): Brief close ending on the contrarian truth's anchor word.

Punchy not preachy. No hedging ("maybe", "kind of"). Declarative throughout. No em dashes. Output ONLY the spoken script. Total ≈55 words.`,
  },
];

export function getRecipeById(id) {
  return RECIPES.find((r) => r.id === id);
}

export function getRecipesByCategory() {
  const byCategory = {};
  for (const r of RECIPES) {
    const cat = r.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(r);
  }
  return byCategory;
}
