// src/canvas/composer/fewshots.js
// The four canonical lanes as { ask, spec } pairs — the Conductor's worked
// examples. Hand-authored from CLAUDE.md "Four Content Pipelines". These MUST
// stay validation-clean (fewshots.test.js enforces it).

export const FEWSHOTS = [
  {
    ask: 'Make me a 45-second Mia UGC reel about clogged pores ruining makeup',
    spec: {
      intent: '45s Mia Chen UGC reel — clogged-pores skincare pain point',
      lane: 'ugc',
      nodes: [
        { ref: 'char', type: 'character', label: 'Mia Chen', config: { characterId: 'mia-chen' } },
        { ref: 'pp', type: 'ingredient', config: { kind: 'pp', index: 0 } },
        { ref: 'hk', type: 'ingredient', config: { kind: 'hk', index: 0 } },
        { ref: 'st', type: 'type', config: { stId: 'st-story' } },
        { ref: 'cv', type: 'type', config: { cvId: 'cv-soft' } },
        { ref: 'gen', type: 'ugc-gen', config: {} },
        { ref: 'split', type: 'clip-splitter', config: {} },
        { ref: 'frames', type: 'avatar-frame', config: {} },
        { ref: 'video', type: 'ugc-video', config: {} },
      ],
      edges: [
        { from: 'char', to: 'pp' }, { from: 'char', to: 'hk' },
        { from: 'pp', to: 'gen' }, { from: 'hk', to: 'gen' },
        { from: 'st', to: 'gen' }, { from: 'cv', to: 'gen' },
        { from: 'gen', to: 'split' }, { from: 'split', to: 'frames' },
        { from: 'split', to: 'video' }, { from: 'frames', to: 'video' },
      ],
      rationale: 'Full UGC lane: persona + one pain point + one hook through script gen, split into 9s clips, framed, rendered on Kling 3.0.',
    },
  },
  {
    ask: 'Carousel video about why AI agents fail at long tasks',
    spec: {
      intent: 'Carousel video — AI agents failing long-horizon tasks',
      lane: 'carousel-video',
      nodes: [
        { ref: 'script', type: 'niche-gen', config: { topic: 'why AI agents fail at long tasks', tone: 'analytical', length: 'medium' } },
        { ref: 'title', type: 'title-card', config: {} },
        { ref: 'art', type: 'gami-art', config: {} },
        { ref: 'sandwich', type: 'frame-sandwich', config: {} },
        { ref: 'deck', type: 'carousel', config: {} },
        { ref: 'comp', type: 'remotion-comp', config: {} },
      ],
      edges: [
        { from: 'script', to: 'title' }, { from: 'script', to: 'art' },
        { from: 'title', to: 'sandwich' }, { from: 'art', to: 'sandwich' },
        { from: 'art', to: 'deck' }, { from: 'script', to: 'deck' },
        { from: 'sandwich', to: 'comp' }, { from: 'deck', to: 'comp' },
      ],
      rationale: 'Carousel video lane: niche script feeds title card + 16-GAMI art, frame-sandwiched on Kling 3.0, composited into slides via Remotion.',
    },
  },
  {
    ask: 'Quick 16-gami carousel on prompt injection basics',
    spec: {
      intent: '16-gami carousel — prompt injection basics',
      lane: '16gami',
      nodes: [
        { ref: 'script', type: 'niche-gen', config: { topic: 'prompt injection basics', tone: 'educational', length: 'short' } },
        { ref: 'art', type: 'gami-art', config: {} },
        { ref: 'deck', type: 'carousel', config: {} },
      ],
      edges: [
        { from: 'script', to: 'art' },
        { from: 'art', to: 'deck' }, { from: 'script', to: 'deck' },
      ],
      rationale: 'Leanest lane: script → origami art → carousel deck.',
    },
  },
  {
    ask: 'Animated short video explaining zero-trust, with a QC pass before scheduling',
    spec: {
      intent: 'Zero-trust explainer video, QC-gated, scheduled via Postiz',
      lane: 'video',
      nodes: [
        { ref: 'script', type: 'niche-gen', config: { topic: 'zero-trust security explained simply', tone: 'educational', length: 'medium' } },
        { ref: 'art', type: 'gami-art', config: {} },
        { ref: 'vprompt', type: 'vid-prompt', config: {} },
        { ref: 'vid', type: 'kie-img2vid', config: {} },
        { ref: 'qc', type: 'qc-gate', config: {} },
        { ref: 'post', type: 'postiz', config: {} },
      ],
      edges: [
        { from: 'script', to: 'art' }, { from: 'script', to: 'vprompt' },
        { from: 'art', to: 'vprompt' }, { from: 'art', to: 'vid' },
        { from: 'vprompt', to: 'vid' }, { from: 'vid', to: 'qc' },
        { from: 'qc', to: 'post' },
      ],
      rationale: 'Video lane with publish tail: QC Gate sits before Postiz, per house rule.',
    },
  },
];
