// src/canvas/engine/ugcPrompts.test.js
import { describe, it, expect } from 'vitest';
import { defaultCharacters } from '../../data/characters.js';
import {
  characterContinuity,
  characterBroll,
  characterSpeechStyle,
  characterAmbience,
} from '../../data/sora2.js';
import { buildClipSplitSystemPrompt, repairClipJson, assembleClipPrompts } from './ugcPrompts.js';

const mia = defaultCharacters.find((c) => c.id === 'mia-chen');

// Mirror of ugcPrompts.js sanitize: strip double quotes, normalize em/en dashes to hyphens.
const sanitize = (s) => (s || '').replace(/"/g, "'").replace(/—/g, '-').replace(/–/g, '-');
// Mirror of ugcPrompts.js firstSentence: first ./!/? boundary, else whole string.
const firstSentence = (s) => {
  const t = (s || '').trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).trim();
};

// Data-derived expectations for the demo character under test (mia-chen).
const miaUgc = characterContinuity[mia.id].ugc;
const miaCharDesc = sanitize(miaUgc.character);
const miaSettingDesc = sanitize(miaUgc.setting);
const miaStyleDesc = sanitize(miaUgc.style);
const miaAmbience = sanitize(characterAmbience[mia.id]);
const miaSpeechStyle = characterSpeechStyle[mia.id];
const miaBroll = characterBroll[mia.id];
const miaCharEssence = firstSentence(miaCharDesc);
const miaSettingEssence = firstSentence(miaSettingDesc);

// id deliberately absent from characterContinuity/characterBroll/characterSpeechStyle/characterAmbience
const fallbackChar = { id: 'no-such-character', name: 'Testy McTest', avatar: 'A "test" person — plain hoodie.' };

describe('buildClipSplitSystemPrompt — mia-chen (real continuity data)', () => {
  const prompt = buildClipSplitSystemPrompt(mia);

  it('CHARACTER line is the sanitized UGC continuity block (em dashes -> hyphens)', () => {
    expect(prompt).toContain(`CHARACTER: ${miaCharDesc}`);
    // sanity: the em-dash -> hyphen sanitization actually happened on the character data
    // (the source continuity uses an em dash here; the sanitized block must not).
    expect(characterContinuity[mia.id].ugc.character).toContain('natural texture —');
    expect(miaCharDesc).toContain('natural texture - visible pores');
    expect(miaCharDesc).not.toContain('—');
  });

  it('SETTING line is the sanitized UGC continuity setting', () => {
    expect(prompt).toContain(`SETTING: ${miaSettingDesc}`);
  });

  it('STYLE line strips double quotes from continuity data', () => {
    expect(prompt).toContain(`STYLE: ${miaStyleDesc}`);
    // the source style uses double quotes around 'getting ready'; they must be single now
    expect(miaStyleDesc).toContain("Real 'getting ready' energy");
    expect(miaStyleDesc).not.toContain('"');
  });

  it('BACKGROUND SOUND block carries the sanitized character ambience', () => {
    expect(prompt).toContain(`BACKGROUND SOUND:\n${miaAmbience}`);
  });

  it('SPEECH STYLE is injected unsanitized (raw continuity text survives)', () => {
    expect(prompt).toContain(`SPEECH STYLE: ${miaSpeechStyle}`);
    // a distinctive phrase from the raw speech style is carried through verbatim
    expect(prompt).toContain('Talks like she is FaceTiming her best friend.');
  });

  it('B-ROLL OPTIONS are numbered from the character broll bank', () => {
    expect(prompt).toContain(
      `B-ROLL OPTIONS (pick from these for b-roll clips):\n1. ${miaBroll[0]}\n2. ${miaBroll[1]}`
    );
  });

  it('contains the CLIP RULES block verbatim', () => {
    expect(prompt).toContain(`CLIP RULES:
- TALKING clips: 9 seconds. Dialogue MUST be 22 words or fewer (~2.5 words/sec, slow deliberate pacing). Pack 1-2 short sentences per clip.
- B-ROLL clips: 10 seconds. NO dialogue, NO lip movement. Voiceover added in post.
- MAXIMUM 7 clips, MAXIMUM 63 seconds total. Aim for 5-6 clips.
- Structure: 1 hook (9s) + 3-4 dialogue (9s each) + optional 1 b-roll (10s) + 1 CTA (9s)
- Merge short sentences greedily into 9s clips. Do NOT make a clip for every sentence.`);
  });

  it('contains the OUTPUT FORMAT block verbatim and ends with the JSON example', () => {
    expect(prompt).toContain(`OUTPUT FORMAT — respond with ONLY a valid JSON array. No markdown fences, no commentary.
Do NOT include a "prompt" field. Instead include these short fields that I will assemble into the final prompt:
- "scene_action": what the character physically does (1-2 sentences)
- "camera": camera movement (e.g. "Slow push-in to close-up")
- "mood": 1-3 mood words (e.g. "warm, revelatory")`);
    expect(prompt).toContain('NEVER use double quotes inside string values. Use single quotes. NEVER use em dashes.');
    expect(prompt).toContain('{ "type": "hook", "duration": 9, "dialogue": "the hook line", "scene_action": "what character does", "camera": "camera move", "mood": "mood words" },');
    expect(prompt.endsWith(']')).toBe(true);
  });
});

describe('buildClipSplitSystemPrompt — fallback character (not in continuity maps)', () => {
  const prompt = buildClipSplitSystemPrompt(fallbackChar);

  it('CHARACTER falls back to the sanitized avatar field', () => {
    expect(prompt).toContain("CHARACTER: A 'test' person - plain hoodie.");
  });

  it('SETTING/PALETTE empty, LIGHTING and STYLE use the documented fallback strings', () => {
    expect(prompt).toContain('SETTING: \nLIGHTING: Natural diffused lighting. iPhone HDR auto-exposure.');
    expect(prompt).toContain('COLOR PALETTE: \nSTYLE: iPhone 15 Pro front-camera selfie with slight handheld camera shake.');
  });

  it('ambience falls back to Natural room ambient', () => {
    expect(prompt).toContain('BACKGROUND SOUND:\nNatural room ambient');
  });

  it('speech style falls back to the generic line with the character name', () => {
    expect(prompt).toContain('SPEECH STYLE: Speaks naturally as Testy McTest. Conversational cadence.');
  });

  it('b-roll falls back to the single generic action with the character name', () => {
    expect(prompt).toContain(
      'B-ROLL OPTIONS (pick from these for b-roll clips):\n1. Testy McTest performing a characteristic action in their environment. No speaking.'
    );
  });

  it('SCENE ACTION placeholder uses the character name (template em dash preserved)', () => {
    expect(prompt).toContain('[What Testy McTest physically does in this clip — specific body language, gestures, expressions]');
  });
});

describe('repairClipJson', () => {
  it('strips ```json fences', () => {
    const out = repairClipJson('```json\n[{"type": "hook", "duration": 9}]\n```');
    expect(out).toBe('[{"type": "hook", "duration": 9}]');
    expect(JSON.parse(out)).toEqual([{ type: 'hook', duration: 9 }]);
  });

  it('strips bare ``` fences', () => {
    const out = repairClipJson('```\n[{"type": "cta"}]\n```');
    expect(JSON.parse(out)).toEqual([{ type: 'cta' }]);
  });

  it('escapes an interior unescaped double quote', () => {
    const out = repairClipJson('[{"dialogue": "he said "wow" out loud"}]');
    expect(JSON.parse(out)).toEqual([{ dialogue: 'he said "wow" out loud' }]);
  });

  it('converts a raw newline inside a string to \\n', () => {
    const out = repairClipJson('[{"dialogue": "line one\nline two"}]');
    expect(out).toContain('line one\\nline two');
    expect(JSON.parse(out)).toEqual([{ dialogue: 'line one\nline two' }]);
  });

  it('leaves valid JSON unchanged', () => {
    const raw = '[{"type": "broll", "duration": 10, "dialogue": ""}]';
    expect(repairClipJson(raw)).toBe(raw);
    expect(JSON.parse(repairClipJson(raw))).toEqual([{ type: 'broll', duration: 10, dialogue: '' }]);
  });
});

describe('assembleClipPrompts', () => {
  it('dialogue clip gets the quoted DIALOGUE line and the V4 performance block', () => {
    const clips = assembleClipPrompts(
      [{ type: 'dialogue', duration: 9, dialogue: 'This serum changed my skin.', scene_action: 'Mia leans toward camera', camera: 'Slow push-in', mood: 'warm' }],
      mia
    );
    expect(clips).toHaveLength(1);
    const p = clips[0].prompt;
    expect(p.startsWith(`CHARACTER: ${miaCharEssence} (face & wardrobe locked by the first frame.)`)).toBe(true);
    expect(p).toContain("DIALOGUE: 'This serum changed my skin.'");
    expect(p).toContain(
      'PERFORMANCE (V4): Speaking mid-thought, not performing. Natural pauses allowed. Emotional restraint over theatrics. Influencer cadence BANNED. Quiet confidence over hype.'
    );
    expect(p).toContain('SCENE ACTION: Mia leans toward camera');
    expect(p).toContain('CAMERA: Slow push-in');
    expect(p).toContain('MOOD: warm');
    expect(p).toContain(`BACKGROUND SOUND: ${miaAmbience}`);
    // raw clip fields are preserved alongside the assembled prompt
    expect(clips[0].type).toBe('dialogue');
    expect(clips[0].duration).toBe(9);
    expect(clips[0].dialogue).toBe('This serum changed my skin.');
  });

  it('broll clip gets NONE dialogue, the no-lip-movement performance line, and camera/mood defaults', () => {
    const clips = assembleClipPrompts([{ type: 'broll', duration: 10, dialogue: '', scene_action: 'Close-up of the serum bottle' }], mia);
    const p = clips[0].prompt;
    expect(p).toContain('DIALOGUE: NONE - voiceover in post');
    expect(p).toContain('PERFORMANCE: NO dialogue, NO lip movement. Pure physical presence. Breathing visible.');
    expect(p).not.toContain('PERFORMANCE (V4)');
    expect(p).toContain('CAMERA: Static medium shot');
    expect(p).toContain('MOOD: natural');
  });

  it('every assembled prompt ends with the REALISM RULES (V4) line', () => {
    const clips = assembleClipPrompts(
      [
        { type: 'hook', duration: 9, dialogue: 'Okay wait.', scene_action: 'Waves', camera: 'Static', mood: 'warm' },
        { type: 'broll', duration: 10, dialogue: '', scene_action: 'Serum close-up' },
      ],
      mia
    );
    for (const c of clips) {
      expect(c.prompt).toContain(
        'REALISM RULES (V4): True handheld iPhone 15 Pro front-camera micro-shake throughout. Mouth and lip sync remain flawless. Zero finger warping. Zero finger overlap near camera.'
      );
      expect(c.prompt.endsWith('Zero finger overlap near camera.')).toBe(true);
    }
  });

  it('SCENE ACTION falls back to clip.prompt then empty string, and the assembled prompt overwrites clip.prompt', () => {
    const clips = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x', prompt: 'legacy scene text' }], mia);
    expect(clips[0].prompt).toContain('SCENE ACTION: legacy scene text');
    expect(clips[0].prompt).not.toBe('legacy scene text');
    const empty = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x' }], mia);
    expect(empty[0].prompt).toContain('SCENE ACTION: \nCAMERA: Static medium shot');
  });

  it('CHARACTER line is the first-sentence essence + first-frame anchor, not the full paragraph', () => {
    const p = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x', scene_action: 'y' }], mia)[0].prompt;
    expect(p).toContain(`CHARACTER: ${miaCharEssence} (face & wardrobe locked by the first frame.)`);
    // later sentences of the continuity paragraph are dropped (the first frame carries them)
    expect(p).not.toContain('Soft brown eyes, straight black hair');
    expect(p).not.toContain('Skin texture fully preserved');
  });

  it('SETTING line is the first-sentence essence', () => {
    const p = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x', scene_action: 'y' }], mia)[0].prompt;
    expect(p).toContain(`SETTING: ${miaSettingEssence}`);
    expect(p).not.toContain('Morning natural light pouring through a frosted window');
  });

  it('collapses LIGHTING/PALETTE/STYLE into one LOOK line and drops the VISUAL PROMPT header', () => {
    const p = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x', scene_action: 'y' }], mia)[0].prompt;
    expect(p).toContain('LOOK: iPhone 15 Pro front-camera selfie.');
    expect(p).not.toContain('VISUAL PROMPT:');
    expect(p).not.toContain('\nLIGHTING:');
    expect(p).not.toContain('COLOR PALETTE:');
  });

  it('omits the first-frame anchor when the character has no appearance essence', () => {
    const noAppearance = { id: 'no-such-character', name: 'Nameless' };
    const p = assembleClipPrompts([{ type: 'dialogue', duration: 9, dialogue: 'x', scene_action: 'y' }], noAppearance)[0].prompt;
    expect(p.startsWith('CHARACTER: \nSETTING: ')).toBe(true);
    expect(p).not.toContain('face & wardrobe locked');
  });
});

describe('assembleClipPrompts — kie 2500-char cap (lean V4)', () => {
  // Realistic worst case: a 2-sentence scene_action + a 22-word dialogue line — the
  // most Claude emits per the clip-planner rules. The old verbose template (full
  // continuity paragraphs repeated on every clip) cleared 2500 here and kie 422'd.
  const WORST_ACTION =
    'Mia leans in close to the bathroom mirror, eyebrows lifting as a slow, knowing smile spreads across her face while the morning light catches the glow on her freshly cleansed skin. She gestures with one open hand toward the row of skincare bottles on the marble counter behind her, then eases back with a quiet, satisfied nod.';
  const WORST_DIALOGUE =
    'I have been using this serum every single morning for two weeks now and my skin has honestly never looked this clear before.';
  const clipFixtures = [
    { type: 'hook', duration: 9, dialogue: WORST_DIALOGUE, scene_action: WORST_ACTION, camera: 'Slow push-in to close-up', mood: 'warm, revelatory' },
    { type: 'dialogue', duration: 9, dialogue: WORST_DIALOGUE, scene_action: WORST_ACTION, camera: 'Slow push-in to close-up', mood: 'warm, revelatory' },
    { type: 'cta', duration: 9, dialogue: WORST_DIALOGUE, scene_action: WORST_ACTION, camera: 'Slow push-in to close-up', mood: 'warm, revelatory' },
    { type: 'broll', duration: 10, dialogue: '', scene_action: WORST_ACTION, camera: 'Static macro shot', mood: 'calm, observational' },
  ];

  for (const ch of defaultCharacters) {
    it(`keeps every clip-type prompt under 2500 chars for ${ch.name}`, () => {
      const clips = assembleClipPrompts(clipFixtures, ch);
      for (const c of clips) {
        expect(c.prompt.length).toBeLessThan(2500);
      }
    });
  }
});
