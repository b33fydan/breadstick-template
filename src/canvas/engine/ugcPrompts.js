// src/canvas/engine/ugcPrompts.js
/**
 * Single browser-side source for the UGC lane clip-split prompt system.
 * All three pieces are mirrored byte-for-byte from CanvasView.jsx onClipSplit
 * (base cb7e2f8): the character derivation block + V4 clip-planner system
 * prompt, the JSON repair walker, and the V4 prompt assembly. The mirrored
 * regions keep CanvasView's original indentation ON PURPOSE so a mechanical
 * byte-diff (normalizing only \r) stays identical — do not reformat them.
 * If a string changes here, change it in CanvasView.jsx too.
 */
import { characterContinuity, characterBroll, characterSpeechStyle, characterAmbience } from '../../data/sora2.js';

// Shared derivation of the per-character prompt parts (mirrors the lookup
// block at the top of onClipSplit). Used by buildClipSplitSystemPrompt and
// assembleClipPrompts so both stay in lockstep with the legacy handler.
function deriveUgcPromptParts(character) {
    const charId = character?.id || '';
    const brollActions = characterBroll[charId] || [`${character?.name || 'Character'} performing a characteristic action in their environment. No speaking.`];
    const speechStyle = characterSpeechStyle[charId] || `Speaks naturally as ${character?.name || 'the character'}. Conversational cadence.`;
    const continuity = characterContinuity[charId];
    const ugc = continuity?.ugc || {};
    // Strip double quotes from all character data to prevent JSON breakage in Claude's output
    const sanitize = (s) => (s || '').replace(/"/g, "'").replace(/—/g, '-').replace(/–/g, '-');
    const charDesc = sanitize(ugc.character || character?.avatar || '');
    const settingDesc = sanitize(ugc.setting || '');
    const lightingDesc = sanitize(ugc.lighting || 'Natural diffused lighting. iPhone HDR auto-exposure.');
    const paletteDesc = sanitize(ugc.palette || '');
    const styleDesc = sanitize(ugc.style || 'iPhone 15 Pro front-camera selfie with slight handheld camera shake.');
    const ambience = sanitize(characterAmbience?.[charId] || 'Natural room ambient');
    const charName = character?.name || 'Character';
  return { brollActions, speechStyle, charDesc, settingDesc, lightingDesc, paletteDesc, styleDesc, ambience, charName };
}

export function buildClipSplitSystemPrompt(character) {
  const { brollActions, speechStyle, charDesc, settingDesc, lightingDesc, paletteDesc, styleDesc, ambience, charName } = deriveUgcPromptParts(character);

    const systemPrompt = `You are a video clip planner for AI avatar UGC content. You split scripts into clips for Kling 3.0 first-frame-to-video generation.

The avatar photo is provided as the FIRST FRAME. Kling animates from that photo. Your prompt tells Kling WHAT THE CHARACTER DOES — the action, the speaking, the emotion. The prompt must be rich and detailed so Kling produces realistic results.

CLIP RULES:
- TALKING clips: 9 seconds. Dialogue MUST be 22 words or fewer (~2.5 words/sec, slow deliberate pacing). Pack 1-2 short sentences per clip.
- B-ROLL clips: 10 seconds. NO dialogue, NO lip movement. Voiceover added in post.
- MAXIMUM 7 clips, MAXIMUM 63 seconds total. Aim for 5-6 clips.
- Structure: 1 hook (9s) + 3-4 dialogue (9s each) + optional 1 b-roll (10s) + 1 CTA (9s)
- Merge short sentences greedily into 9s clips. Do NOT make a clip for every sentence.

FOR EACH CLIP, generate a prompt in this EXACT structure (as a single string in the "prompt" field):

VISUAL PROMPT:
CHARACTER: ${charDesc}
SETTING: ${settingDesc}
LIGHTING: ${lightingDesc}
COLOR PALETTE: ${paletteDesc}
STYLE: ${styleDesc}

SCENE ACTION:
[What ${charName} physically does in this clip — specific body language, gestures, expressions]

CAMERA:
[Camera movement — slow push-in, static medium, slight drift, etc.]

MOOD: [1-3 mood words]

PERFORMANCE (V4):
- Speaking mid-thought, not performing
- Natural pauses and micro-hesitations allowed
- Emotional restraint over theatrics
- Influencer cadence BANNED — real person energy only
- Quiet confidence over hype

DIALOGUE:
"[The exact dialogue line for this clip, or NONE for b-roll]"

BACKGROUND SOUND:
${ambience}

REALISM RULES (MANDATORY — V4):
- True handheld iPhone 15 Pro front-camera micro-shake throughout
- Mouth and lip sync remain flawless even after 12 seconds — lip sync protection critical
- Zero finger warping, zero finger overlap near camera

SPEECH STYLE: ${speechStyle}

B-ROLL OPTIONS (pick from these for b-roll clips):
${brollActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

OUTPUT FORMAT — respond with ONLY a valid JSON array. No markdown fences, no commentary.
Do NOT include a "prompt" field. Instead include these short fields that I will assemble into the final prompt:
- "scene_action": what the character physically does (1-2 sentences)
- "camera": camera movement (e.g. "Slow push-in to close-up")
- "mood": 1-3 mood words (e.g. "warm, revelatory")

NEVER use double quotes inside string values. Use single quotes. NEVER use em dashes.

[
  { "type": "hook", "duration": 9, "dialogue": "the hook line", "scene_action": "what character does", "camera": "camera move", "mood": "mood words" },
  { "type": "dialogue", "duration": 9, "dialogue": "sentence or two", "scene_action": "action", "camera": "camera", "mood": "mood" },
  { "type": "broll", "duration": 10, "dialogue": "", "scene_action": "b-roll scene description", "camera": "camera", "mood": "mood" },
  { "type": "cta", "duration": 9, "dialogue": "closing line", "scene_action": "action", "camera": "camera", "mood": "mood" }
]`;

  return systemPrompt;
}

export function repairClipJson(raw) {
      // Parse JSON — strip markdown fences, fix newlines and bad chars inside strings
      let jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      // Walk through and fix everything inside quoted strings: newlines, unescaped quotes, tabs
      let fixed = '';
      let inString = false;
      let escaped = false;
      for (let ci = 0; ci < jsonStr.length; ci++) {
        const ch = jsonStr[ci];
        if (escaped) { fixed += ch; escaped = false; continue; }
        if (ch === '\\') { fixed += ch; escaped = true; continue; }
        if (ch === '"') {
          // Check if this quote is inside a string and looks like an unescaped interior quote
          // Heuristic: if we're in a string and the next non-space char is NOT : , ] } then it's interior
          if (inString) {
            const rest = jsonStr.substring(ci + 1).trimStart();
            const nextChar = rest[0] || '';
            if (nextChar === ':' || nextChar === ',' || nextChar === ']' || nextChar === '}' || nextChar === '') {
              inString = false; fixed += ch; continue;
            }
            // Interior quote — escape it
            fixed += '\\"'; continue;
          }
          inString = true; fixed += ch; continue;
        }
        if (inString && (ch === '\n' || ch === '\r')) { if (ch === '\n') fixed += '\\n'; continue; }
        if (inString && ch === '\t') { fixed += '\\t'; continue; }
        fixed += ch;
      }
  return fixed;
}

export function assembleClipPrompts(rawClips, character) {
  const { charDesc, settingDesc, styleDesc, ambience } = deriveUgcPromptParts(character);

      // Lean V4 (kie 2500-char cap): the avatar photo is Kling's first frame, so it
      // already carries appearance/setting/look. Collapse the repeated visual-continuity
      // paragraphs to their first sentence (a boundary, never a mid-sentence cut) and keep
      // the V4 PERFORMANCE/REALISM guidance verbatim. The first sentence is an essence, not
      // a truncation. See docs/superpowers/specs/2026-06-13-ugc-lean-v4-prompt-cap-design.md
      const firstSentence = (s) => {
        const t = (s || '').trim();
        if (!t) return '';
        const m = t.match(/^.*?[.!?](?=\s|$)/);
        return (m ? m[0] : t).trim();
      };
      const charEssence = firstSentence(charDesc);
      const settingEssence = firstSentence(settingDesc);
      const lookEssence = firstSentence(styleDesc);
      const clips = rawClips.map(clip => {
        const isBroll = clip.type === 'broll';
        const dialogueLine = clip.dialogue ? `DIALOGUE: '${clip.dialogue}'` : 'DIALOGUE: NONE - voiceover in post';
        const perfRules = isBroll
          ? 'PERFORMANCE: NO dialogue, NO lip movement. Pure physical presence. Breathing visible.'
          : `PERFORMANCE (V4): Speaking mid-thought, not performing. Natural pauses allowed. Emotional restraint over theatrics. Influencer cadence BANNED. Quiet confidence over hype.`;
        const prompt = [
          `CHARACTER: ${charEssence}${charEssence ? ' (face & wardrobe locked by the first frame.)' : ''}`,
          `SETTING: ${settingEssence}`,
          `LOOK: ${lookEssence}`,
          `SCENE ACTION: ${clip.scene_action || clip.prompt || ''}`,
          `CAMERA: ${clip.camera || 'Static medium shot'}`,
          `MOOD: ${clip.mood || 'natural'}`,
          perfRules,
          dialogueLine,
          `BACKGROUND SOUND: ${ambience}`,
          `REALISM RULES (V4): True handheld iPhone 15 Pro front-camera micro-shake throughout. Mouth and lip sync remain flawless. Zero finger warping. Zero finger overlap near camera.`,
        ].join('\n');
        return { ...clip, prompt };
      });

  return clips;
}
