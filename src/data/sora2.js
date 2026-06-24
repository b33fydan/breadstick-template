// ============================================================
// FutrGroup V4 Realism Framework (integrated from FutrGroup_V2.pdf)
// "If it looks planned, it failed. If it looks unintentional — it passed."
// ============================================================

// Prompt style options — UGC (FutrGroup V4) vs Cinematic (legacy)
export const promptStyles = [
  {
    id: 'ugc',
    label: 'UGC iPhone (V4)',
    description: 'FutrGroup V4 — iPhone 15 Pro front-camera realism, anti-artifact rules, accidental authenticity',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Legacy — 85mm prime lens, editorial photography, polished framing',
  },
];

// V4 Anti-Artifact & Realism Rules — injected into EVERY clip prompt
export const SORA2_V4_REALISM_RULES = `REALISM RULES (MANDATORY — V4):
- True handheld iPhone 15 Pro front-camera micro-shake throughout
- One subtle grip adjustment at ~6-7 seconds — no other hand movement near lens
- Zero finger warping, zero finger overlap near camera
- Skin texture fully preserved — visible pores, natural aging, NO smoothing, NO beauty filters
- Eyes stay naturally soft on lens with zero drifting — stable eye tracking throughout
- Mouth and lip sync remain flawless even after 12 seconds — lip sync protection critical
- Skin stays consistently textured with zero melting or warping past 12s
- Ultra-stable face tracking throughout entire clip
- Natural iPhone HDR grain where shadows meet sunlight — no cinematic color grading
- Subtle autofocus pulse when gesturing — real lens behavior
- Natural breathing bounce in frame
- No glamour lighting — only practical/environmental light sources
- Single continuous take — NO cuts, NO transitions`;

// V4 Hand Safety Rules — per-clip injection
export const SORA2_V4_HAND_SAFETY = `HAND SAFETY (V4):
- Hands stay at chest level or below — never near lens
- Single natural re-grip only — no twisting, no rotation
- No exaggerated finger movement — relaxed, neutral spacing
- If gesturing, palm-open only, small movement, slow and controlled
- No pointing at camera unless explicitly required`;

// V4 Audio Realism — injected into assembly notes
export const SORA2_V4_AUDIO_RULES = `AUDIO REALISM (V4):
- Simulated raw iPhone mic capture — slight compression, natural proximity
- Room tone REQUIRED — never dead silent
- Slight plosive pops, tiny breaths, real mouth clicks permitted
- Environmental ambience bleeds in naturally
- No music unless explicitly stated
- No sound design sweetening
- Overly clean dialogue = suspicious — keep it raw`;

// V4 Performance Rules
export const SORA2_V4_PERFORMANCE = `PERFORMANCE (V4):
- Speaking mid-thought, not performing
- Natural pauses and micro-hesitations allowed
- Emotional restraint over theatrics
- Influencer cadence BANNED — real person energy only
- Quiet confidence over hype
- Small disbelief reactions and knowing looks encouraged`;

// Sora 2 continuity headers per character
// UGC (V4) variants prioritize iPhone front-camera realism
// Cinematic variants preserve legacy 85mm/50mm lens specs
export const characterContinuity = {
  'mia-chen': {
    ugc: {
      character: 'A 24-year-old East Asian woman with clear glowing skin showing natural texture — visible pores, small freckles across her nose. Soft brown eyes, straight black hair pulled back with a claw clip, a few loose strands framing her face. Minimal makeup — tinted moisturizer, touch of blush, clear lip gloss. Wearing an oversized cream waffle-knit top with sleeves pushed to wrists. Small gold hoop earrings. Skin texture fully preserved — natural glow, NO beauty filter, NO smoothing.',
      setting: 'A bright modern bathroom vanity — white marble counter with a round mirror, a few skincare bottles arranged casually (not staged), a glass of water, a folded hand towel. Clean but lived-in. The counter has a small tray with products she is actively using. Morning natural light pouring through a frosted window to the left.',
      lighting: 'Bright natural morning light from a frosted window to the left. Soft and diffused, no harsh shadows. iPhone HDR auto-exposure handles the white bathroom naturally. Ring light reflection barely visible in her eyes — subtle, not obvious. Light feels like 8am bathroom light, not a studio.',
      palette: 'Cream, white marble, soft pink, clear glass, warm gold accents.',
      style: 'iPhone 15 Pro front-camera selfie. Phone propped on counter leaning against mirror, or held in one hand. Natural micro-shake from breathing. She glances between camera and the product in her hands. Occasionally leans into mirror to show skin texture up close. Real "getting ready" energy — not a photoshoot.',
    },
    cinematic: {
      character: 'A 24-year-old East Asian woman with clear glowing skin, natural freckles, soft brown eyes, straight black hair pulled back with a claw clip. Minimal makeup — tinted moisturizer, blush, clear lip gloss. Oversized cream waffle-knit top, small gold hoop earrings.',
      setting: 'A bright modern bathroom vanity — white marble counter, round mirror, casually arranged skincare bottles, a glass of water. Clean, warm, lived-in.',
      lighting: 'Soft natural morning light from a frosted window, diffused and warm. Gentle fill from the mirror reflection. No harsh shadows.',
      palette: 'Cream, white marble, soft pink, clear glass, warm gold.',
      style: 'Shot on 50mm prime lens, medium close-up, shallow depth of field. Beauty editorial feel but approachable — not a magazine ad, more like an elevated vlog. Warm color science.',
    },
  },
  'jake-rivera': {
    ugc: {
      character: 'A 27-year-old Hispanic man with an athletic but approachable lean build — visible forearm veins, natural physique. Short dark hair with a slight fade, clean-shaven with light stubble shadow along jawline. Warm brown skin with natural texture — not airbrushed, pores and slight sheen visible. Wearing a fitted plain charcoal crew-neck t-shirt. Relaxed, confident expression — not posing. Skin texture fully preserved — natural warmth, slight post-workout flush, NO smoothing.',
      setting: 'A clean modern kitchen — white quartz counter with a blender (Ninja or similar), a shaker bottle with liquid in it, and 2-3 supplement bottles arranged naturally (not lined up like an ad). A banana and some ice near the blender. Morning light from a large window behind and to the right. The space looks like a real kitchen — a coffee mug in the background, maybe a dish towel draped over the oven handle.',
      lighting: 'Bright morning light from a large kitchen window behind and to the right, creating a gentle backlit warmth. iPhone HDR balances the backlight naturally. Counter surface reflects some light upward. No studio lighting — just a guy in his kitchen at 7am.',
      palette: 'Charcoal, white quartz, warm brown skin, supplement bottle colors (greens, blacks, whites), stainless steel.',
      style: 'iPhone 15 Pro front-camera selfie. Phone propped on counter or held in one hand while he gestures with the other. Natural micro-shake. He picks up product bottles, shows labels, scoops powder. Occasional glance down at what he is doing then back to camera. Real "morning routine" energy — not a commercial.',
    },
    cinematic: {
      character: 'A 27-year-old Hispanic man, athletic lean build, short dark hair with slight fade, light stubble, warm brown skin. Fitted charcoal crew-neck t-shirt. Relaxed, confident expression.',
      setting: 'A clean modern kitchen — white quartz counter, blender, shaker bottle, supplement bottles arranged naturally. Morning light from a large window.',
      lighting: 'Bright morning backlight from kitchen window, gentle warmth, natural fill from counter reflection. Documentary feel.',
      palette: 'Charcoal, white quartz, warm brown, supplement bottle colors, stainless steel.',
      style: 'Shot on 35mm prime lens, medium close-up, natural depth of field. Health/lifestyle editorial feel — clean but not sterile. Warm, approachable color science.',
    },
  },
};

// Video generation platforms
export const videoPlatforms = [
  {
    id: 'kling',
    label: 'Kling',
    description: 'Full character description in every clip for consistency',
    available: true,
  },
  {
    id: 'veo3',
    label: 'Veo 3',
    description: 'Google Veo 3 — full character description per clip, voice replacement via Resemble AI recommended',
    available: true,
  },
  {
    id: 'sora2',
    label: 'Sora 2',
    description: 'DEPRECATED — OpenAI shut down Sora platform + API. Prompts kept for reference only.',
    available: true,
    deprecated: true,
  },
  {
    id: 'seedance',
    label: 'Seedance 2.0',
    description: 'Full character description in every clip — not yet available in US',
    available: false,
  },
];

// Clip modes — Full Scene (8s), Seedance 9s (long talking), Clip Mode (5s + B-roll)
export const clipModes = [
  {
    id: 'full-scene',
    label: 'Full Scene',
    description: 'Long clips (8s each) — for models that handle extended scenes without artifacts',
  },
  {
    id: 'seedance-9s',
    label: 'Seedance 9s',
    description: '9s all-talking clips — for Seedance 2.0 (10s native, 9s leaves breathing room before harsh cuts)',
  },
  {
    id: 'clip-mode',
    label: 'Clip Mode',
    description: '5s talking clips + B-roll inserts — safe for Kling 3.0, no mouth artifacts',
  },
];

// Full Scene tiers — original long-clip format (future-proof for better models)
const fullSceneTiers = [
  {
    id: 'fs-15s',
    label: '15s Teaser',
    duration: 15,
    clips: [
      { seconds: 8, beat: 'Recognition (Hook)' },
      { seconds: 8, beat: 'Hope (Insight)' },
    ],
    description: 'Punchy hook + one key insight. Maximum scroll-stop power.',
  },
  {
    id: 'fs-30s',
    label: '30s Standard',
    duration: 30,
    clips: [
      { seconds: 8, beat: 'Recognition (Hook)' },
      { seconds: 8, beat: 'Understanding' },
      { seconds: 8, beat: 'Hope (Reframe)' },
      { seconds: 8, beat: 'Empowerment (Close)' },
    ],
    description: 'Full arc: hook, body, reframe, close. Ideal for Reels/TikTok.',
  },
  {
    id: 'fs-45s',
    label: '45s Extended',
    duration: 45,
    clips: [
      { seconds: 8, beat: 'Recognition (Hook)' },
      { seconds: 8, beat: 'Understanding' },
      { seconds: 8, beat: 'Hope' },
      { seconds: 8, beat: 'Insight (Value)' },
      { seconds: 8, beat: 'Empowerment (Close)' },
      { seconds: 4, beat: 'CTA' },
    ],
    description: 'Full emotional journey with dedicated CTA clip.',
  },
  {
    id: 'fs-60s',
    label: '60s Full',
    duration: 60,
    clips: [
      { seconds: 8, beat: 'Recognition (Hook)' },
      { seconds: 8, beat: 'Recognition (Deepen)' },
      { seconds: 8, beat: 'Understanding' },
      { seconds: 8, beat: 'Hope' },
      { seconds: 8, beat: 'Insight (Reframe)' },
      { seconds: 8, beat: 'Insight (Value)' },
      { seconds: 8, beat: 'Empowerment' },
      { seconds: 4, beat: 'CTA' },
    ],
    description: 'Complete 5-beat emotional journey + CTA. Maximum depth.',
  },
];

// Clip Mode tiers — 5s talking + 5s B-roll, safe for current models
const clipModeTiers = [
  {
    id: 'cm-30s',
    label: '30s',
    duration: 30,
    clips: [
      { seconds: 5, beat: 'Recognition (Hook)', type: 'talking' },
      { seconds: 5, beat: 'Recognition (Deepen)', type: 'broll' },
      { seconds: 5, beat: 'Understanding', type: 'talking' },
      { seconds: 5, beat: 'Hope (Reframe)', type: 'talking' },
      { seconds: 5, beat: 'Insight (Value)', type: 'broll' },
      { seconds: 5, beat: 'Empowerment (Close)', type: 'talking' },
    ],
    description: '4 talking + 2 B-roll. Voiceover runs over B-roll. No mouth artifacts.',
  },
  {
    id: 'cm-45s',
    label: '45s',
    duration: 45,
    clips: [
      { seconds: 5, beat: 'Recognition (Hook)', type: 'talking' },
      { seconds: 5, beat: 'Recognition (Deepen)', type: 'broll' },
      { seconds: 5, beat: 'Understanding', type: 'talking' },
      { seconds: 5, beat: 'Understanding', type: 'broll' },
      { seconds: 5, beat: 'Hope', type: 'talking' },
      { seconds: 5, beat: 'Hope (Reframe)', type: 'talking' },
      { seconds: 5, beat: 'Insight (Value)', type: 'broll' },
      { seconds: 5, beat: 'Empowerment (Close)', type: 'talking' },
      { seconds: 5, beat: 'CTA', type: 'talking' },
    ],
    description: '5 talking + 4 B-roll. Full arc with visual breathing room.',
  },
  {
    id: 'cm-60s',
    label: '60s',
    duration: 60,
    clips: [
      { seconds: 5, beat: 'Recognition (Hook)', type: 'talking' },
      { seconds: 5, beat: 'Recognition (Deepen)', type: 'broll' },
      { seconds: 5, beat: 'Understanding', type: 'talking' },
      { seconds: 5, beat: 'Understanding', type: 'broll' },
      { seconds: 5, beat: 'Hope', type: 'talking' },
      { seconds: 5, beat: 'Hope (Reframe)', type: 'talking' },
      { seconds: 5, beat: 'Hope', type: 'broll' },
      { seconds: 5, beat: 'Insight (Reframe)', type: 'talking' },
      { seconds: 5, beat: 'Insight (Value)', type: 'talking' },
      { seconds: 5, beat: 'Insight (Value)', type: 'broll' },
      { seconds: 5, beat: 'Empowerment', type: 'talking' },
      { seconds: 5, beat: 'CTA', type: 'talking' },
    ],
    description: '7 talking + 5 B-roll. Full emotional journey. Mix-and-match ready.',
  },
];

// Seedance 9s tiers — all talking at 9s per clip. No B-roll needed; Seedance 2.0
// doesn't produce the mouth artifacts that forced 5s chunking on Kling.
// 9s over 10s native leaves a 1s tail so the splitter's sentence boundaries don't
// cut mid-mouth-shape.
const seedance9sTiers = [
  {
    id: 'sd-27s',
    label: '27s Tight',
    duration: 27,
    clips: [
      { seconds: 9, beat: 'Recognition (Hook)' },
      { seconds: 9, beat: 'Hope (Reframe)' },
      { seconds: 9, beat: 'Empowerment (Close)' },
    ],
    description: 'Hook → reframe → close. Punchy 3-clip arc at Seedance-native pacing.',
  },
  {
    id: 'sd-45s',
    label: '45s',
    duration: 45,
    clips: [
      { seconds: 9, beat: 'Recognition (Hook)' },
      { seconds: 9, beat: 'Understanding' },
      { seconds: 9, beat: 'Hope (Reframe)' },
      { seconds: 9, beat: 'Insight (Value)' },
      { seconds: 9, beat: 'Empowerment (Close)' },
    ],
    description: 'Full 5-beat emotional arc in 9s increments.',
  },
  {
    id: 'sd-63s',
    label: '63s Extended',
    duration: 63,
    clips: [
      { seconds: 9, beat: 'Recognition (Hook)' },
      { seconds: 9, beat: 'Recognition (Deepen)' },
      { seconds: 9, beat: 'Understanding' },
      { seconds: 9, beat: 'Hope (Reframe)' },
      { seconds: 9, beat: 'Insight (Value)' },
      { seconds: 9, beat: 'Empowerment' },
      { seconds: 9, beat: 'CTA' },
    ],
    description: 'All 7 beats with dedicated CTA clip. Maximum depth at Seedance pacing.',
  },
];

// Get tiers based on clip mode
export function getTiersForMode(mode) {
  if (mode === 'clip-mode') return clipModeTiers;
  if (mode === 'seedance-9s') return seedance9sTiers;
  return fullSceneTiers;
}

// Exported for backward compat — defaults to full scene
export const videoTiers = fullSceneTiers;

// Scene actions mapped to emotional beats
const beatActions = {
  'Recognition (Hook)': {
    actions: [
      'looks directly at camera with a knowing expression, leans forward slightly',
      'removes reading glasses and holds them in right hand, makes direct eye contact',
      'pauses mid-action, turns to camera with concerned expression',
    ],
    camera: 'Static medium close-up with subtle handheld drift',
    mood: 'direct, attention-commanding, concerned',
  },
  'Recognition (Deepen)': {
    actions: [
      'nods slowly, gestures with one hand as if listing points',
      'shifts weight, leans against surface, maintains eye contact',
      'tilts head slightly, expression shifts to empathetic understanding',
    ],
    camera: 'Slow push-in from medium to medium close-up',
    mood: 'knowing, empathetic, validating',
  },
  'Understanding': {
    actions: [
      'gestures with both hands at chest level, explaining intently',
      'counts on fingers, nodding with each point',
      'makes a "stop" gesture, then opens hands palm-up',
    ],
    camera: 'Static medium close-up, eye level',
    mood: 'warm, knowing, validating',
  },
  'Hope': {
    actions: [
      'expression softens, slight smile begins to form, straightens posture',
      'places hand briefly over heart, then gestures outward',
      'eyes brighten, chin lifts slightly, open body language',
    ],
    camera: 'Slow push-in to close-up',
    mood: 'hopeful, warm, encouraging',
  },
  'Hope (Reframe)': {
    actions: [
      'expression shifts from serious to knowing smile, raises one finger',
      'leans forward with emphasis, then settles back with warmth',
      'pauses for beat, then speaks with renewed energy',
    ],
    camera: 'Slow push-in to close-up',
    mood: 'revelatory, warm, perspective-shifting',
  },
  'Hope (Insight)': {
    actions: [
      'expression softens into a confident half-smile, nods once',
      'gestures forward with open palm, inviting understanding',
    ],
    camera: 'Slow push-in to close-up',
    mood: 'hopeful, insightful, warm',
  },
  'Insight (Value)': {
    actions: [
      'leans forward with intensity, gestures with pointed finger',
      'taps surface for emphasis, then opens hand to explain',
      'holds up fingers counting key points, direct eye contact',
    ],
    camera: 'Static close-up at eye level',
    mood: 'confident, authoritative, generous',
  },
  'Insight (Reframe)': {
    actions: [
      'pauses, tilts head, then delivers insight with conviction',
      'shifts from concerned expression to knowing confidence',
      'breaks eye contact briefly looking down, then back up with clarity',
    ],
    camera: 'Static close-up, minimal movement',
    mood: 'revelatory, calm authority, perspective-shifting',
  },
  'Empowerment': {
    actions: [
      'warm, steady gaze directly at camera, slight nod, open expression',
      'settles back comfortably, relaxed confident posture, warm half-smile',
      'places hand over heart briefly, then gestures gently toward camera',
    ],
    camera: 'Slow pull-back from close-up to medium close-up',
    mood: 'empowering, warm, grounding',
  },
  'Empowerment (Close)': {
    actions: [
      'warm, steady gaze directly at camera, slight affirming nod',
      'relaxed posture, genuine smile, open and inviting expression',
    ],
    camera: 'Static medium close-up, warm framing',
    mood: 'empowering, warm, resolved',
  },
  'CTA': {
    actions: [
      'gestures toward camera (pointing to "link" direction), warm confident expression',
      'slight lean forward, direct but warm eye contact, small nod',
    ],
    camera: 'Static medium close-up',
    mood: 'warm, inviting, confident',
  },
};

// B-roll scene actions per character — iPhone UGC style, no lip sync needed
// Voiceover from ElevenLabs plays over these. Must stay in character's world.
export const characterBroll = {
  'mia-chen': [
    'Close-up of hands squeezing serum onto fingertips. Product catches the morning light.',
    'Mia glances at herself in the bathroom mirror, tilts her chin checking skin texture. Natural.',
    'Slow close-up pan across skincare bottles arranged on the vanity counter. Steam from shower visible.',
    'Mia pats product gently onto cheeks with fingertips, leaning slightly toward the mirror.',
  ],
  'jake-rivera': [
    'Close-up of a scoop of protein powder being dropped into a blender. Powder cloud rises slightly.',
    'Jake\'s hand picks up a supplement bottle, tilts it to read the label. Sets it back down.',
    'Slow pour of a smoothie from blender into a glass. Thick, green. Kitchen window light behind.',
    'Jake takes a sip from the glass, nods slightly. Sets it on the counter. Morning kitchen light.',
  ],
};

// Background sounds per character
export const characterAmbience = {
  'mia-chen': 'Bathroom morning ambient — faint water drip from faucet, soft room echo off tile, distant muffled sounds from apartment',
  'jake-rivera': 'Kitchen morning ambient — faint blender residual hum, refrigerator compressor, distant neighborhood sounds through window',
};

// Voice cadence/tone per character for Sora 2 speech prompts
export const characterSpeechStyle = {
  'mia-chen': 'Casual, slightly breathy cadence with natural excitement building. Talks like she is FaceTiming her best friend. Sentence fragments when excited. Slight vocal fry on certain words. Pauses to look at the product, then back at camera. Real and unscripted energy.',
  'jake-rivera': 'Conversational, measured cadence. No-hype delivery. Slightly deeper register but relaxed, not performing. Names specific ingredients and timelines naturally. Pauses to show product or take a sip. Genuine "sharing what works for me" energy.',
};

export function buildSora2Prompts(character, scriptText, tierId, orientation = 'portrait', platform = 'sora2', promptStyle = 'ugc', clipMode = 'full-scene') {
  const allTiers = getTiersForMode(clipMode);
  const tier = allTiers.find(t => t.id === tierId);
  if (!tier) return null;
  const isClipMode = clipMode === 'clip-mode';

  const continuity = characterContinuity[character.id];
  const isUGC = promptStyle === 'ugc';

  // Select style-appropriate continuity blocks
  // For known characters, pick ugc or cinematic variant; for custom characters, build from profile
  const styleVariant = isUGC ? continuity?.ugc : continuity?.cinematic;
  const charBlock = styleVariant?.character || continuity?.ugc?.character || continuity?.cinematic?.character || character.avatar;
  const settingBlock = styleVariant?.setting || continuity?.ugc?.setting || continuity?.cinematic?.setting || character.avatar.split('Lighting')[0].trim();
  const lightingBlock = styleVariant?.lighting || continuity?.ugc?.lighting || continuity?.cinematic?.lighting || 'Natural soft lighting, warm tone';
  const paletteBlock = styleVariant?.palette || continuity?.ugc?.palette || continuity?.cinematic?.palette || 'Neutral tones';
  const styleBlock = styleVariant?.style || continuity?.ugc?.style || continuity?.cinematic?.style || 'Shot on 50mm lens, natural lighting, authentic feel';
  const ambience = characterAmbience[character.id] || 'Quiet room ambient tone';
  const speechStyle = characterSpeechStyle[character.id] || `Speaks in character as ${character.name}. Natural, conversational cadence.`;

  const size = orientation === 'portrait' ? '720x1280' : '1280x720';
  const isSora2 = platform === 'sora2';
  const hasCameo = !!character.cameoName;

  // In clip mode, only distribute dialogue to talking clips (B-roll gets voiceover overlay)
  const talkingClips = isClipMode ? tier.clips.filter(c => c.type === 'talking') : tier.clips;
  const scriptLines = splitScriptForClips(scriptText, talkingClips);

  // Full continuity header — always built for reference/fallback
  const continuityHeader = `CHARACTER: ${charBlock}
SETTING: ${settingBlock}
LIGHTING: ${lightingBlock}
COLOR PALETTE: ${paletteBlock}
STYLE: ${styleBlock}`;

  // V4 realism block — only injected in UGC mode
  const realismBlock = isUGC ? `\n\n${SORA2_V4_REALISM_RULES}\n\n${SORA2_V4_HAND_SAFETY}` : '';

  // Cameo reference line for Sora 2
  const cameoRef = character.cameoName || character.handle || `@${character.name.toLowerCase().replace(/\s+/g, '')}`;

  // B-roll actions for this character
  const brollActions = characterBroll[character.id] || [
    `${character.name} in their environment, performing a characteristic action. No speaking. iPhone handheld.`,
  ];

  let talkingIndex = 0;
  let brollIndex = 0;

  const clips = tier.clips.map((clip, i) => {
    const isBroll = isClipMode && clip.type === 'broll';
    const beat = beatActions[clip.beat] || beatActions['Understanding'];
    const modelLabel = platform === 'kling' ? 'kling' : platform === 'veo3' ? 'veo-3' : platform === 'seedance' ? 'seedance-2.0' : 'sora-2';
    const clipLabel = isBroll ? `B-ROLL — ${clip.beat}` : clip.beat;

    if (isBroll) {
      // B-roll clip — no dialogue, no lip sync, voiceover plays over
      const brollAction = brollActions[brollIndex % brollActions.length];
      brollIndex++;

      return `=== CLIP ${i + 1} of ${tier.clips.length} — ${clipLabel} (${clip.seconds}s) ===
TYPE: B-ROLL (voiceover plays over — no lip sync needed)

API PARAMETERS:
  model: ${modelLabel}
  size: ${size}
  seconds: ${clip.seconds}

VISUAL PROMPT:
SETTING: ${settingBlock}
LIGHTING: ${lightingBlock}
COLOR PALETTE: ${paletteBlock}
STYLE: ${styleBlock}

SCENE ACTION:
${brollAction}

CAMERA:
${beat.camera}

MOOD: ${beat.mood}

NO DIALOGUE — voiceover from ElevenLabs overlays this clip in post.

BACKGROUND SOUND:
${ambience}`;

    } else if (isSora2 && hasCameo) {
      // Sora 2 with cameo — lean prompt
      const action = beat.actions[talkingIndex % beat.actions.length];
      const dialogue = scriptLines[talkingIndex] || '';
      talkingIndex++;

      return `=== CLIP ${i + 1} of ${tier.clips.length} — ${clipLabel} (${clip.seconds}s) ===
${isClipMode ? 'TYPE: TALKING (lip sync required)\n' : ''}
API PARAMETERS:
  model: sora-2
  size: ${size}
  seconds: ${clip.seconds}

VISUAL PROMPT:
${cameoRef} ${action}.

SETTING: ${settingBlock}
LIGHTING: ${lightingBlock}

SPEECH CADENCE:
${speechStyle}

CAMERA:
${beat.camera}

MOOD: ${beat.mood}
${isUGC ? `\n${SORA2_V4_PERFORMANCE}` : ''}

DIALOGUE:
"${dialogue}"

BACKGROUND SOUND:
${ambience}${realismBlock}`;
    } else {
      // Kling / Veo 3 / Seedance / Sora 2 without cameo — full description
      const action = beat.actions[(isBroll ? brollIndex : talkingIndex) % beat.actions.length];
      const dialogue = scriptLines[talkingIndex] || '';
      talkingIndex++;

      return `=== CLIP ${i + 1} of ${tier.clips.length} — ${clipLabel} (${clip.seconds}s) ===
${isClipMode ? 'TYPE: TALKING (lip sync required)\n' : ''}
API PARAMETERS:
  model: ${modelLabel}
  size: ${size}
  seconds: ${clip.seconds}

VISUAL PROMPT:
${continuityHeader}

SCENE ACTION:
${character.name} ${action}.

CAMERA:
${beat.camera}

MOOD: ${beat.mood}
${isUGC ? `\n${SORA2_V4_PERFORMANCE}` : ''}

DIALOGUE:
"${dialogue}"

BACKGROUND SOUND:
${ambience}${realismBlock}`;
    }
  });

  // Clean script text for voiceover — strip metadata, keep only spoken dialogue
  const cleanScript = scriptText
    .replace(/\[SCRIPT TYPE:.*?\]/g, '')
    .replace(/\[LENGTH:.*?\]/g, '')
    .replace(/\[LIFE-FORCE 8:.*?\]/g, '')
    .replace(/\[CONVERSION LEVEL:.*?\]/g, '')
    .replace(/\[HOOK.*?\]/g, '')
    .replace(/\[BODY\]/g, '')
    .replace(/\[CLOSE.*?\]/g, '')
    .replace(/```/g, '')
    .replace(/NOTES:[\s\S]*$/m, '')
    .replace(/---[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Assembly notes — lean workflow metadata only, no bloat
  const assembly = `=== ASSEMBLY NOTES ===

CLIP ORDER: ${tier.clips.map((_, i) => i + 1).join(' → ')}
TOTAL DURATION: ${tier.clips.reduce((sum, c) => sum + c.seconds, 0)}s
ORIENTATION: ${orientation === 'portrait' ? 'Portrait 720x1280 (TikTok/Reels)' : 'Landscape 1280x720 (YouTube)'}
PLATFORM: ${platform === 'sora2' ? 'Sora 2 (DEPRECATED)' : platform === 'kling' ? 'Kling' : platform === 'veo3' ? 'Veo 3' : 'Seedance 2.0'}${isSora2 && hasCameo ? `\nCAMEO: ${cameoRef}` : ''}
TRANSITIONS: Hard cuts between clips. No dissolves.
CAPTIONS: 30% from top, bold sans-serif, white + dark shadow. Bottom 20% clear for TikTok UI.

VOICEOVER SCRIPT (clean):
"${cleanScript}"

ELEVENLABS:
  Voice: ${character.voice.split('.')[0]}
  Pacing: Natural, conversational`;

  return {
    clips,
    assembly,
    continuityHeader,
    tier,
    platform,
    promptStyle,
    hasCameo: isSora2 && hasCameo,
    cameoRef: isSora2 && hasCameo ? cameoRef : null,
  };
}

// Max words per clip based on ~2.5 words/sec speaking rate
// Slightly generous to allow natural phrasing, but prevents clipping
function maxWordsForClip(seconds) {
  return Math.floor(seconds * 2.5);
}

function splitScriptForClips(scriptText, clips) {
  const clipCount = Array.isArray(clips) ? clips.length : clips;
  if (!scriptText) return Array(clipCount).fill('');

  // Clean script text — remove metadata headers
  const cleaned = scriptText
    .replace(/\[SCRIPT TYPE:.*?\]/g, '')
    .replace(/\[LENGTH:.*?\]/g, '')
    .replace(/\[LIFE-FORCE 8:.*?\]/g, '')
    .replace(/\[CONVERSION LEVEL:.*?\]/g, '')
    .replace(/\[HOOK.*?\]/g, '')
    .replace(/\[BODY\]/g, '')
    .replace(/\[CLOSE.*?\]/g, '')
    .replace(/```/g, '')
    .replace(/NOTES:[\s\S]*$/m, '')
    .replace(/---[\s\S]*$/m, '')
    .trim();

  // Split into sentences
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);

  if (sentences.length === 0) return Array(clipCount).fill('');

  // Per-clip word budget from duration (2.5 wps). When clips is just a count,
  // assume 5s clips as a safe default.
  const budgets = Array.isArray(clips)
    ? clips.map(c => maxWordsForClip(c.seconds || 5))
    : Array(clipCount).fill(maxWordsForClip(5));

  // Greedy forward-fill — every sentence MUST land in some clip, NEVER silently
  // dropped. Each clip may exceed its budget by up to 50% before we advance to
  // the next clip; this spreads inevitable overflow across multiple clips
  // instead of dumping it all on the last one. The final clip absorbs whatever
  // remains and is allowed to overflow without limit (better an overlong tail
  // than a missing CTA).
  const segments = Array(clipCount).fill('');
  const counts = Array(clipCount).fill(0);
  let idx = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(w => w.length > 0).length;
    const overflowCap = Math.floor(budgets[idx] * 1.5);

    if (idx < clipCount - 1 && counts[idx] > 0 && counts[idx] + words > overflowCap) {
      idx++;
    }

    segments[idx] = (segments[idx] ? segments[idx] + ' ' : '') + sentence;
    counts[idx] += words;
  }

  return segments;
}
