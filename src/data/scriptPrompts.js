// Explicit .js extension so this module also loads under plain Node ESM
// (the MCP server imports it directly); Vite resolves it the same either way.
import { scriptTypes, conversionLevels } from './scriptTypes.js';

const LIFE_FORCE_8 = [
  'Survival, enjoyment of life, life extension',
  'Enjoyment of food and beverages',
  'Freedom from fear, pain, and danger',
  'Sexual companionship',
  'Comfortable living conditions',
  'To be superior, winning, keeping up with the Joneses',
  'Care and protection of loved ones',
  'Social approval',
];

// Auto-detect Life-Force 8 from pain point text
function detectLifeForce8(painPointText) {
  const text = painPointText.toLowerCase();
  const matches = [];

  if (text.match(/die|death|health|winded|weight|doctor|body|sleep|chest|nervous|bird|nature|hobby|outdoor|identify|singing|spot|backyard|tired|energy|crash|supplement|vitamin|workout/)) matches.push(LIFE_FORCE_8[0]);
  if (text.match(/food|eat|diet|calories|meal|smoothie|protein|powder/)) matches.push(LIFE_FORCE_8[1]);
  if (text.match(/terrified|afraid|fear|anxiety|panic|spiral|worry|shame|broken|unstable|missing|wrong|scared|breaks out/)) matches.push(LIFE_FORCE_8[2]);
  if (text.match(/wife|husband|partner|relationship|look at|attraction|skin.*glow|beautiful|confident/)) matches.push(LIFE_FORCE_8[3]);
  if (text.match(/savings|money|broke|paycheck|prices|afford|income|ripped off|insurance|yard|feeder|garden|attract|spend.*hundreds|expensive/)) matches.push(LIFE_FORCE_8[4]);
  if (text.match(/stupid|embarrass|behind|failure|gym.*22|performing|beginner|overwhelming|too old|don't know|not seeing results|cakey|tired.*skin|marketing/)) matches.push(LIFE_FORCE_8[5]);
  if (text.match(/children|kids|family|burden|future|grandkid|grandchild/)) matches.push(LIFE_FORCE_8[6]);
  if (text.match(/trust|scam|guru|fine.*work|performing|too old|silly|judge|claims.*different|good marketing|influencer/)) matches.push(LIFE_FORCE_8[7]);

  return matches.length > 0 ? matches : [LIFE_FORCE_8[2]]; // default to freedom from fear
}

function getConversionStructure(levelId, isUGC = false) {
  if (isUGC) {
    switch (levelId) {
      case 'no-cta':
        return `No product CTA. End with genuine enthusiasm about the result — "my skin has never looked like this" or "I genuinely feel different." Pure value, pure reaction. The product demo speaks for itself.`;
      case 'soft-bridge':
        return `Soft Product Mention (80% experience, 20% product):
Share the genuine experience and results first. Mention the product naturally at the end: "I will leave a link below if you want to try it" or "this is the one if you have been looking." No hard sell — just honest endorsement. Like recommending something to a friend.`;
      case 'testimonial-bridge':
        return `Result-Forward CTA (60% transformation, 40% product):
Lead with before/after results or the specific change noticed. Show genuine surprise or satisfaction. Bridge to product naturally: "This is the one that actually worked" or "I was not expecting this from a [product category]." Include a clear but warm product mention.`;
      case 'direct-ask':
        return `Product Spotlight CTA (30% context, 70% product):
This is an ad creative. Be upfront about showcasing the product. Open with the problem, demonstrate the product in use, show results. Direct but still authentic — "Let me show you why this is the only [product] I use now." Include link/purchase language.`;
      default:
        return '';
    }
  }
  switch (levelId) {
    case 'no-cta':
      return `No CTA. End with pure emotion — an empowering statement or quiet affirmation.
At most, a soft "follow for more" if it feels natural.`;
    case 'soft-bridge':
      return `Soft Bridge CTA (80% value, 20% CTA):
After delivering full value, add a natural bridge: "and if you want the complete system..." or "I put everything I know into..."
Make the CTA feel like a gift, not a pitch. Use the character's CTA style.`;
    case 'testimonial-bridge':
      return `Testimonial Bridge CTA (60% proof, 40% invitation):
Include a brief transformation story or result. If the story is about a third person (a viewer, student, neighbor, anyone who is not the speaker), the FIRST sentence introducing them MUST be a noun phrase, NEVER a pronoun.

REQUIRED SENTENCE PATTERN — do not deviate:
- Sentence A (introduce as a noun phrase): "A neighbor of mine watched her feeder for three years." or "One of my students kept missin' the dawn chorus." or "A viewer named Sarah emailed me last month."
- Sentence B+ (now you can use a pronoun, because A established who she/he is): "She never knew one bird from another." or "He told me he gave up after the first week."

FORBIDDEN openings — these all assume the viewer already knows who you are talking about:
- "She said she'd watched..."
- "He told me he..."
- "They never thought..."
- "This guy I know..."  (unless followed immediately by a defining clause — "This guy I know who runs the feed store told me...")

After the transformation story, connect to the audience: "You might be feeling the same way they were..."
Bridge to the offer as the logical next step. Include the ManyChat trigger word naturally.`;
    case 'direct-ask':
      return `Direct Ask CTA (30% context, 70% offer):
Be direct about the offer. State clearly what they get, why it works, and exactly what to do.
Use the 7-part formula: Hook → Agitate → Bridge → Offer → Proof → CTA → Urgency.
Include specific ManyChat trigger word instruction.`;
    default:
      return '';
  }
}

function getToneFromScriptType(typeId) {
  const type = scriptTypes.find(t => t.id === typeId);
  return type ? { tone: type.tone, pacing: type.pacing, duration: type.duration } : {};
}

export function buildSystemPrompt(character, selections) {
  const painPoint = character.painPoints[selections.painPoint];
  const hook = character.hooks[selections.hook];
  const scriptType = scriptTypes.find(t => t.id === selections.scriptType);
  const conversionLevel = conversionLevels.find(c => c.id === selections.conversionLevel);
  const lifeForce8 = detectLifeForce8(painPoint);
  const toneInfo = getToneFromScriptType(selections.scriptType);

  const isUGC = character.isUGC || character.monetization?.isShowcase;

  return `You are a world-class ${isUGC ? 'UGC ad scriptwriter. You write product showcase scripts in a conversational first-person register — the kind that stop scrolling and drive conversions for brands. Aim for natural spoken cadence: casual phrasing, everyday word choice, mid-thought energy — not polished ad-read cadence or announcer delivery.' : 'AI influencer scriptwriter. You write scripts that are production-ready — they can be pasted directly into ElevenLabs for voice generation with zero editing.'}

## CHARACTER PROFILE
Name: ${character.name}
Handle: ${character.handle}
Niche: ${character.niche}
Tagline: ${character.tagline}
Demographic: ${character.demographic}
${isUGC ? `\n### UGC SHOWCASE CONTEXT\nThis character is a UGC creator shell for generating product demo and review content. The scripts are portfolio pieces and ad creatives — NOT influencer content with funnels. The character demonstrates products naturally as if sharing a genuine discovery with a friend.\nProduct Categories: ${character.monetization?.productCategories?.join(', ') || character.niche}` : ''}

### Voice & Speech Patterns
${character.voice}

### Visual Identity (for context — affects tone references)
${character.avatar}

### CTA Style
${character.ctaStyle}

### ${isUGC ? 'Product Context' : 'Monetization'}
${isUGC ? `Type: UGC Product Showcase / Ad Creative\nCategories: ${character.monetization?.productCategories?.join(', ') || character.niche}\nNote: The specific product name can be generic (e.g., "this serum", "this greens powder") — the script is a template that works for any brand in this category.` : `Product: ${character.monetization.product}\nPrice: ${character.monetization.price}\n${selections.trigger ? `ManyChat Trigger Word: ${selections.trigger}` : ''}\n${selections.ctaMechanism ? `CTA Mechanism: ${selections.ctaMechanism}` : ''}`}

---

## SELECTED INGREDIENTS
Pain Point: "${painPoint}"
Hook: "${hook}"
Script Type: ${scriptType.name} (${scriptType.duration})
Conversion Level: ${conversionLevel.name} — ${conversionLevel.ratio}
Life-Force 8 Desires: ${lifeForce8.join(', ')}

---

## SCRIPT GENERATION RULES

### Structure: Emotional Journey Framework
Beat 1 - Recognition (I See You): Call out the pain point so specifically they think "this is about me."
Beat 2 - Understanding (I Get It): Demonstrate deep knowledge of their experience. What they've tried, how they feel, their secret frustrations.
Beat 3 - Hope (There's a Way): Pivot from pain to possibility. The promise, not the solution yet.
Beat 4 - Insight (Here's How): Deliver the reframe, technique, or wisdom. Make it feel like a gift.
Beat 5 - Empowerment (You Can Do This): Close with emotion. Leave them feeling capable, hopeful, or at peace.

### Universal Flow: Emotion → Logic → Emotion
- Lead with emotion (hook that creates feeling)
- Deliver logic (the insight, reframe, or wisdom)
- Close with emotion (leave them with a feeling)

### Psychology Requirements
- Tap into these Life-Force 8 desires: ${lifeForce8.join(', ')}
- Use Mental Movie language — specific, visual, sensory. NOT vague.
  BAD: "You'll feel better about your life"
  GOOD: "You'll wake up excited about the day instead of hitting snooze three times while dreading what's ahead"
- Include at least ONE reframe — a moment where you help them see their problem differently
- Connect every feature to a benefit (the Feature-Benefit test)
- Use the character's EXACT speech patterns and phrases
- Never use generic self-help language ("embrace the journey", "live your best life")

### Conversion Level Instructions
${getConversionStructure(selections.conversionLevel, isUGC)}

### Script Type: ${scriptType.name}
Tone: ${toneInfo.tone}
Pacing: ${toneInfo.pacing}
Target Duration: ${scriptType.duration}
HARD WORD LIMIT: ${scriptType.maxWords || 150} words maximum. This is non-negotiable.
Scripts are delivered as voiceover at ~2.5 words/second. Every extra word pushes the clip over duration and clips the audio. Write TIGHT — cut filler, merge sentences, favor punchy phrasing over elaborate buildup. If you can say it in 8 words, do not use 15.

### SHORT-SENTENCE RULE (CRITICAL)
This script will be split into short video clips by sentence boundary. Each sentence MUST be a complete thought that stands on its own.

MANDATORY sentence rules:
- Every sentence must be 12 WORDS OR FEWER. No exceptions.
- Every sentence must be a COMPLETE THOUGHT. No cliffhangers, no trailing "who...", no sentences that need the next line to make sense.
- Use periods aggressively. Break long thoughts into multiple short sentences.
- Prefer punchy fragments over complex sentences.

BAD (17 words, incomplete thought when split):
"I have been watchin birds since before I could read and I reckon the saddest thing I see is folks who"

GOOD (split into complete 12-word sentences):
"I have been watchin birds since before I could read."
"The saddest thing I see is folks who never look up."

Write the script as a sequence of short, self-contained sentences. Each one must stand alone if isolated into its own clip.

### CONTINUITY RULE (CRITICAL — failures here have shipped before)
Sentences play back-to-back, packed into short video clips. A viewer watches them in order. Anything the script references must already be established by an earlier sentence.

MANDATORY continuity rules:
- Every "she", "he", "they", "her", "him", "them", "this person", "that one" MUST refer to someone introduced in a PRIOR sentence in this same script.
- The FIRST mention of any third-party character must be a NOUN PHRASE, not a pronoun. Use "a neighbor of mine", "a viewer named Sarah", "one of my students", "a guy who emailed me last month", "an old buddy" — never just "she" or "he."
- Do not reference events, places, dates, names, products, or numbers that the script has not yet established. The viewer only knows what you have told them.

BAD (clip 5 introduces "she" with zero setup — viewer has no idea who this is, and the previous clip about "those birds" gives them no clue):
Clip 4: "Because those birds are talkin' to you every single morning. You just don't have the language yet."
Clip 5: "She said she'd watched her feeder for three years. Same birds. Never knew one from another."

GOOD (clip 5 introduces the testimonial subject as a noun phrase before the pronoun):
Clip 4: "Because those birds are talkin' to you every single morning. You just don't have the language yet."
Clip 5: "A neighbor of mine watched her feeder for three years. Same birds. Never knew one from another."
Clip 6: "Seven days after she started listening, she could name every visitor by sound."

Re-read your draft as if watching the clips one at a time. If clip N suddenly mentions a character, place, or detail that clips 1 through N-1 never set up, rewrite to introduce it first.

---

## REFERENCE: HIGH-PERFORMING SCRIPT PATTERNS

These patterns come from scripts that generated thousands in revenue:

1. **Opening Move:** Direct, bold statement or vivid scene-setting. No throat-clearing.
2. **Progressive Depth:** Specific visual/sensory details build the emotional journey.
3. **Reframe Moment:** Central perspective shift that makes the content saveable.
4. **Mental Movie Language:** Every benefit as a specific image, not abstraction.
5. **Soft Close:** Ends with emotion, sometimes loops back to opening for closure.
6. **Return Pattern:** Some scripts loop back to the opening with added depth.

---

## PRE-OUTPUT CHECK (MANDATORY — do this before writing the final script)

Read your draft sentence by sentence. For each sentence:
1. Find every pronoun: "she", "he", "they", "her", "him", "them", "this person", "that one". For each pronoun, the noun it refers to MUST appear in an EARLIER sentence in the same script. If a pronoun's antecedent is missing, rewrite the sentence (or add an introducing sentence before it) so the noun comes first.
2. Find every named person, place, date, number, product, or event. Confirm the script established it in an earlier sentence. If not, either introduce it earlier or cut it.
3. Confirm clip N follows logically from clips 1 through N-1. No narrative jump cuts.

If you find a violation, fix the script BEFORE producing output. Do not output a script that fails any of these checks.

## OUTPUT FORMAT

Produce the script in this exact format:

\`\`\`
[SCRIPT TYPE: ${scriptType.name}]
[LENGTH: ${scriptType.duration}]
[LIFE-FORCE 8: ${lifeForce8.join(', ')}]
[CONVERSION LEVEL: ${conversionLevel.name}]

[HOOK — first 3 seconds]
{The hook, adapted naturally to the pain point}

[BODY]
{The full script body following the emotional journey beats}

[CLOSE${selections.conversionLevel !== 'no-cta' ? ' + CTA' : ''}]
{Closing lines${selections.conversionLevel !== 'no-cta' ? ' with CTA in character voice' : ''}}
\`\`\`

CRITICAL RULES:
- STRICT WORD LIMIT: ${scriptType.maxWords || 150} words maximum. Count them. If over, cut ruthlessly — tighten phrasing, remove redundant lines, merge beats. Every word must earn its place.
- Write ONLY the spoken words. No stage directions, no parentheticals, no [pause] markers.
- The script must sound natural when read aloud — it goes directly into ElevenLabs.
- Stay in character voice the ENTIRE time. Every word must sound like ${character.name}.
- The hook line must be the EXACT selected hook or a very close adaptation of it.
- Do NOT include any meta-commentary outside the script format above.`;
}

export function buildUserPrompt(character, selections) {
  const painPoint = character.painPoints[selections.painPoint];
  const hook = character.hooks[selections.hook];
  const scriptType = scriptTypes.find(t => t.id === selections.scriptType);
  const conversionLevel = conversionLevels.find(c => c.id === selections.conversionLevel);

  return `Write a ${scriptType.name} script for ${character.name}.

Pain Point: "${painPoint}"
Hook: "${hook}"
Conversion Level: ${conversionLevel.name}
${selections.trigger ? `Trigger Word: ${selections.trigger}` : ''}
${selections.ctaMechanism ? `CTA Mechanism: ${selections.ctaMechanism}` : ''}

Write the complete script now. Remember: production-ready, paste-into-ElevenLabs quality. Stay in ${character.name}'s voice throughout.`;
}

export function buildProductionPrompts(character, selections, scriptText) {
  const scriptType = scriptTypes.find(t => t.id === selections.scriptType);
  const toneInfo = getToneFromScriptType(selections.scriptType);
  const painPoint = character.painPoints[selections.painPoint];
  const hook = character.hooks[selections.hook];
  const conversionLevel = conversionLevels.find(c => c.id === selections.conversionLevel);

  // Determine expression from pain point + script type
  let expression = 'warm and approachable';
  if (painPoint.match(/terrified|afraid|fear|anxiety|panic/i)) expression = 'concerned, empathetic';
  if (painPoint.match(/angry|rigged|ripped off|scam/i)) expression = 'serious, knowing';
  if (scriptType.id === 'affirmation-vision') expression = 'warm, hopeful, gentle smile';
  if (scriptType.id === 'quiet-truth') expression = 'calm, thoughtful, intimate';
  if (scriptType.id === 'pattern-interrupt') expression = 'direct, slightly intense, attention-commanding';

  const elevenlabs = `Voice: ${character.voice.split('.')[0]}.
Tone: ${toneInfo.tone}
Pacing: ${toneInfo.pacing}

Script text:
${scriptText}`;

  const chatgpt = `Generate a portrait photograph of ${character.avatar}
Expression: ${expression}.
Camera: Medium close-up, slight depth of field, shot on 85mm lens.
Style: Photorealistic, editorial photography quality.
CRITICAL: Must match this character's established appearance exactly.`;

  const kling = `Animate this character speaking directly to camera.
Movement: Subtle head movements, natural blinks, occasional hand gestures.
Lip sync: Match to provided audio track.
Duration: ${scriptType.duration}.
Maintain: Consistent character appearance, no morphing or drift.
Background: ${character.avatar.split('Lighting')[0].trim()} — static, no movement.`;

  // Extract key content for slideshow
  const slideshow = `6 slides at 1024x1536 (portrait):
Slide 1: HOOK — "${hook}" at 30% from top, bold font, max 6 words per line
Slide 2: PROBLEM — "${painPoint.substring(0, 80)}..."
Slide 3: DISCOVERY — The reframe or insight tease from the script
Slide 4: TRANSFORMATION 1 — First piece of value from the script
Slide 5: TRANSFORMATION 2 — Second piece of value from the script
Slide 6: CTA — ${conversionLevel.id === 'no-cta' ? '"Follow for more"' : `Based on ${conversionLevel.name} level`}

Text rules: 30% from top, manual line breaks every 4-6 words, bottom 20% clear (TikTok UI), white text with dark shadow for readability.
Scene: ${character.avatar.split('.')[0]}, consistent across all 6 slides.`;

  const caption = `Write a storytelling caption for this post in ${character.name}'s voice.
NOT an ad. Conversational. Include the hook restated naturally.
${selections.trigger ? `Include trigger word "${selections.trigger}" CTA naturally.` : ''}
${conversionLevel.id !== 'no-cta' ? `Mention the offer (${character.monetization.product}) naturally.` : ''}

Hashtags: 5-10 relevant hashtags for the ${character.niche} niche.`;

  const manychat = selections.trigger ? `Trigger word: ${selections.trigger}
Auto-DM message: Write a warm auto-reply in ${character.name}'s voice thanking them for reaching out, describing ${character.monetization.product} (${character.monetization.price}), and including the link. Keep it conversational and on-brand.
Platform: Instagram / Facebook Messenger` : null;

  return { elevenlabs, chatgpt, kling, slideshow, caption, manychat };
}

export function buildClipboardPrompt(character, selections) {
  const systemPrompt = buildSystemPrompt(character, selections);
  const userPrompt = buildUserPrompt(character, selections);

  return `=== SYSTEM PROMPT (paste as system/instructions) ===

${systemPrompt}

=== USER PROMPT ===

${userPrompt}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RECIPE AUTHOR — produces ONE coherent ~60s monologue.
//
// Different from the ingredient-mixer prompts above. The mixer asks for a
// labeled, sectioned script. The author asks for a single-take monologue with
// no seams: the hook, pain, story, and CTA must be woven into one thread, not
// stacked as discrete beats. Output is the spoken text only — no [HOOK]/[BODY]
// labels, no metadata.
// ─────────────────────────────────────────────────────────────────────────────

export function buildRecipeAuthorSystemPrompt(character) {
  return `You are ${character.name}, an AI influencer in the niche: ${character.niche}.

VOICE — internalize this fully:
${character.voice}

TAGLINE: ${character.tagline}

TASK: Write ONE coherent ~60-second monologue. Not four ingredients glued together. ONE thread of thought.

HARD RULES:
1. ONE coherent piece. The hook flows into the story flows into the lesson flows into the CTA. No section breaks. No "Now let me tell you about…" transitions. No hook-then-pivot.
2. ≤ 12 words per sentence. Complete thoughts. No semicolons. No em-dashes splicing two ideas. The clip splitter cuts on sentence boundaries — never write a sentence that can't stand alone.
3. ~150 words total (60 sec at ~2.5 words/sec). Slightly under is fine; over is not.
4. Antecedents before pronouns. The first time you reference a third person, use a noun phrase ("a neighbor of mine", "one of my students", "a viewer named Sarah"). Only use "she/he/they" AFTER they've been introduced as a noun. This rule is non-negotiable — pronouns without antecedents kill the script.
5. Voice consistency throughout. Use the character's signature phrases naturally. Never break voice for a "marketing" sentence.
6. Output the SPOKEN SCRIPT ONLY. No [HOOK], no [BODY], no [CLOSE], no metadata, no notes, no markdown headers. Just the words ${character.name} would speak, paragraph-broken for readability.

ANTI-PATTERN (DO NOT DO THIS):
"If you hear this sound, look up. [pause] Now I had a neighbor who never noticed birds. [pause] Most people miss what's in their backyard. [pause] I made a guide — comment BIRDS to get it."
↑ That's four disconnected beats with hard transitions. It reads like an ad-libbed assembly. Avoid this at all costs.

PATTERN (DO THIS):
The hook IS the story IS the lesson IS the soft pitch — they're the same arc told once, no seams. The viewer should be unable to tell where one "ingredient" ends and the next begins.`;
}

export function buildRecipeAuthorUserPrompt(character, painLabel, hookLabel, ctaLabel) {
  return `Write a Recipe for ${character.name}.

The recipe must touch all three of these — but woven into ONE coherent monologue, not stacked:

PAIN: ${painLabel}
HOOK direction (open here): ${hookLabel}
CTA direction (close here): ${ctaLabel}

ManyChat trigger word (use it naturally in the closing): ${(character.monetization?.triggers && character.monetization.triggers[0]) || 'BIO'}
Lead magnet / product: ${character.monetization?.product || character.monetization?.leadMagnet || 'guide in bio'}

Output: the spoken script, paragraph-broken, no labels. ~150 words. ≤12 words per sentence. One thread, no seams.`;
}

