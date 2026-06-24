export const scriptTypes = [
  {
    id: 'affirmation-vision',
    name: 'Affirmation / Vision',
    duration: '45-90 sec',
    maxWords: 170,
    description: 'Heavy hope. Paints a vivid picture of the transformation. Best for building emotional connection and shareability.',
    tone: 'warm',
    pacing: 'steady, building',
  },
  {
    id: 'problem-solution',
    name: 'Problem-Solution',
    duration: '45-75 sec',
    maxWords: 140,
    description: 'Insight delivery. Names the problem clearly, then delivers a specific reframe or actionable solution.',
    tone: 'direct',
    pacing: 'measured',
  },
  {
    id: 'quiet-truth',
    name: 'Quiet Truth',
    duration: '60-90 sec',
    maxWords: 170,
    description: 'Intimate wisdom. Feels like a private conversation. Best for deep trust-building and save-worthy content.',
    tone: 'intimate',
    pacing: 'slow, deliberate',
  },
  {
    id: 'pattern-interrupt',
    name: 'Pattern Interrupt',
    duration: '30-60 sec',
    maxWords: 100,
    description: 'Unexpected opener that stops the scroll. Short, punchy, high retention. Best for reach and new audience.',
    tone: 'energetic',
    pacing: 'punchy, fast',
  },
  {
    id: 'story-based',
    name: 'Story-Based',
    duration: '60-90 sec',
    maxWords: 170,
    description: 'Narrative structure with a character arc. Best for relatability and emotional investment.',
    tone: 'conversational',
    pacing: 'natural, flowing',
  },
];

export const conversionLevels = [
  {
    id: 'no-cta',
    name: 'No CTA',
    ratio: 'Pure Value',
    description: '100% value content. No mention of offer. Builds trust and reach. Use for 70% of content.',
  },
  {
    id: 'soft-bridge',
    name: 'Soft Bridge',
    ratio: '80% value / 20% CTA',
    description: 'Value-first with a gentle pointer to the offer. Natural, never salesy. "If you want to go deeper..."',
  },
  {
    id: 'testimonial-bridge',
    name: 'Testimonial Bridge',
    ratio: '60% proof / 40% invitation',
    description: 'Social proof driven. Shows transformation results, then invites them to get the same. Use for 25% of content.',
  },
  {
    id: 'direct-ask',
    name: 'Direct Ask',
    ratio: '30% context / 70% offer',
    description: 'The offer IS the content. Clear, confident, no apology. Use sparingly — 5% of content max.',
  },
];
