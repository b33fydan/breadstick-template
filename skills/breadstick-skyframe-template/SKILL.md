---
name: breadstick-skyframe-template
description: Apply the Skyframe shortform motion-graphic template to talking-head or Ray-Ban POV videos. Use when the user has a recorded shortform + transcript and wants the consistent 5-beat visual language — blurry-bg yellow 3D + 8-bit pixel intro that doubles as the IG/TT/YT thumbnail, anchor-word-driven middle beats from a fixed effect vocabulary, single Opus shine + chime on the CTA emphasis word. Triggers on "skyframe this video", "add motion graphics to this shortform", "wire up the 5-beat", "Ray-Ban POV overlay", "Yapping shortform overlay", or whenever the user hands over a 1080×1920 recording + transcript JSON and wants the canonical Skyframe treatment.
metadata:
  tags: skyframe, shortform, motion-graphics, remotion, ray-ban, yapping, hook-and-motion
---

## When to use

The user records a shortform (Ray-Ban POV or talking-head "Yapping" style) and wants to wire motion graphics on top using the Skyframe canonical visual language. They'll typically have:

- A 1080×1920 portrait MP4 (test007.mp4 is the canonical reference)
- A transcript JSON with word-level timestamps (ElevenLabs Scribe output, e.g. `renders/popped/edit/transcripts/test007.json`)
- A 5-beat script (Beat 1 = hook, 2/3/4 = subject, 5 = CTA)

Do NOT use this skill for:
- Longform creator videos (use `breadstick-longform`)
- Caption-only burn-ins without the full template (use `breadstick-overlay`)
- One-off creative motion experiments (use `motion-craft` for principles, build freely)
- Carousel slides (use the `carousel` skill)

## The 5-beat contract

Every Skyframe shortform has exactly 5 beats. The structure is non-negotiable — this is the load-bearing discipline.

| Beat | Role | Effect | Anchored to |
|------|------|--------|-------------|
| **1** | Hook | `RayBanIntro` (mandatory, 3s, blurry bg) | Opening words; frame at ~1.5s = portrait thumbnail |
| **2** | Subject | One of {KaraokeCard, CompactCard, Win95Terminal, AsciiPlanet} | Replay-worthy noun/verb in beat 2 |
| **3** | Subject | One of {KaraokeCard, CompactCard, Win95Terminal, AsciiPlanet} | Replay-worthy noun/verb in beat 3 |
| **4** | Subject | One of {KaraokeCard, CompactCard, Win95Terminal, AsciiPlanet} | Replay-worthy noun/verb in beat 4 |
| **5** | CTA | `OpusGlisten` (mandatory, 1 per video) + chime | Single emphasis word in the CTA |

**Why this structure works:**
- Beat 1 is the thumbnail. Pause your video at ~1.5s and the frame must read as a static title card on someone's IG/TT/YT profile grid. This is what makes the channel feel cohesive.
- Beats 2/3/4 each carry a single anchor word — pick what the audience would replay. One anchor per beat. Don't double up.
- Beat 5 is the signature. The single Opus shine + chime is the audio-visual punchline. Diluting it (multiple shines, multiple chimes) breaks the signature.

## The motion-graphic vocabulary

Six effects live in `src/remotion/skyframe/`. Import them via the barrel:

```jsx
import {
  RayBanIntro, KaraokeCard, CompactCard, TrashCompactor,
  Win95Terminal, OpusGlisten, AsciiPlanet,
  SkyframeAudioCues, ensureFonts, SKYFRAME_PALETTE,
} from '../skyframe';
```

### `RayBanIntro` — Beat 1, MANDATORY

3-second hook. Yellow Anton 3D extruded hero phrase + white 5×7 pixel-block 8-bit phrase + blurred base.

```jsx
<RayBanIntro
  frame={frame} fps={fps}
  startSec={0} endSec={3.0}
  topWord="You're"           // small white prefix
  heroPhrase="BURNING THROUGH"  // big yellow Anton w/ 3D shadow
  midWord="your"              // small white connector
  pixelPhrase="CLOUD CODE"    // chunky 8-bit pixel-block (white)
  subtitle="context is bloated."  // muted white tail
/>
```

**Pair with FFmpeg base blur** during composite:
`gblur=sigma=22:enable='between(t,0,3)'`

The pixel font supports A-Z, 0-9, `.,!?` and space. Punctuation outside that set renders as space.

### `KaraokeCard` — Beats 2/3/4 (use for short captionable messages with one hero word)

Glass-morphism card with karaoke body words and ONE yellow underlined hero word. Best for "do this thing" or "remember this number" beats.

```jsx
<KaraokeCard
  frame={frame} fps={fps}
  startSec={6.0} endSec={12.0}
  position="bottom-left"   // 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
  eyebrow="Tip 1 · Context"
  words={['Keep', 'CLAUDE.md', 'under', '40K', 'characters']}
  heroWord="CLAUDE.md"     // must match exactly one word above
/>
```

The hero word becomes yellow + underline-draw + size bump. All other words karaoke from cyan→white as they enter. Eyebrow stays teal.

### `CompactCard` — Beats 2/3/4 (use when the anchor is a command/function/action)

Bottom-centered terminal-style card with optional side-art SVG. Default side art is `TrashCompactor` (the input→output compactor). Pass any React node for custom visualizations.

```jsx
<CompactCard
  frame={frame} fps={fps}
  startSec={15.5} endSec={21.0}
  command="/compact"
  subtitle="without breaking content"
  sideArt="trashCompactor"  // 'trashCompactor' | null | <CustomSvg />
  sideArtProps={{ inputLabel: '245K', resultLabel: '40K' }}
/>
```

### `Win95Terminal` — Beats 2/3/4 (use when the anchor is "reset / wipe / clean")

Retro Win95 chrome → random code streams → user types `command` → screen wipes → `payoff` line types out in green. Lingers naturally for 0.5–1s after typing finishes (controlled by `endSec`).

```jsx
<Win95Terminal
  frame={frame} fps={fps}
  startSec={21.5} endSec={28.0}
  command="/clear"
  payoff="Fresh context. No drift."
  // Optional overrides:
  // codeLines={[...]}, title="C:\\Claude\\context.exe"
  // typeStartFrame={14}, wipeStartFrame={30}, payoffStartFrame={82}
/>
```

Sync the `typeStartFrame` to the audio — the user's typed command should land character-by-character with the spoken `/clear` in the recording.

### `AsciiPlanet` — Beats 2/3/4 (decorative; use sparingly)

Spinning ASCII disc on transparent bg. Letters change cell-by-cell to sell rotation. Works for "global / world / scale" anchors.

```jsx
<AsciiPlanet
  frame={frame} fps={fps}
  startSec={38.0} endSec={43.0}
/>
```

Don't pair with a card-heavy adjacent beat — visual saturation tanks impact.

### `OpusGlisten` — Beat 5, MANDATORY

THE Skyframe signature. Serif hero word + lower-left → upper-right gold gradient sweep + 4-point sparkle pop in upper-right corner + halo ring radial expansion. Pair with `chime.mp3` at the sparkle peak.

```jsx
<OpusGlisten
  frame={frame} fps={fps}
  startSec={34.5} endSec={38.0}
  word="Opus"     // the single CTA emphasis word
/>
```

**Window length minimum: 3.0s.** The shine + sparkle + linger arc needs the room. The chime audio is wired separately via `SkyframeAudioCues` at frame ~64 of the window (relative to startSec * fps).

## Discipline rules

These are the rails. Break them only with a strong reason and document why in the composition file.

### Palette
- `#FFD24A` (yellow) = hero color. Used by RayBanIntro hero phrase, KaraokeCard hero word, OpusGlisten gradient. Never use yellow on supporting elements.
- `#00D9C8` (teal) = accent. Eyebrows, bottom rules, KaraokeCard supporting elements.
- `#FFFFFF` = body text.
- `SKYFRAME_PALETTE` exports the canonical hex codes and glow values; import rather than re-typing.

### Hero hierarchy
- **One** hero word per video gets the OpusGlisten treatment. Never multiple.
- Each KaraokeCard uses **one** hero word. Don't underline two.
- The Beat 1 hero phrase is the visual title — make it 1-2 short words max ("BURNING THROUGH", "DROWNING IN", "BUILT FOR").

### Audio cues
- `bubble.mp3` — every motion graphic entry (intro, each beat). One per appearance.
- `whoosh.mp3` — transitions / pattern interrupts (Win95 wipe, planet entry, big motion-blur swaps).
- `chime.mp3` — **ONE per video**. Reserved for OpusGlisten sparkle peak. The chime is the load-bearing signature partner; using it twice kills it.

Wire all audio via `SkyframeAudioCues`:
```jsx
<SkyframeAudioCues
  bubbles={[0, 144, 372, 516]}   // absolute frame indices
  whooshes={[547, 912]}
  chime={892}                    // Opus sparkle peak frame
/>
```

### Hook portrait-readability
After rendering, pull frame 36 (1.5s) and review at thumbnail size. If the hero phrase isn't the first thing you read, the hook isn't doing its job. Common fixes: shorten phrase, bump font, simplify subtitle.

### Window timing
Every effect anchors to spoken word timestamps from the transcript. Find the start frame of the anchor word, subtract ~0.5s for entry runway, and that's your `startSec`. The `endSec` should give the effect at least 0.5s of linger past its visual climax.

## Authoring workflow

When the user hands over a recording + transcript + 5-beat script:

1. **Read the transcript JSON.** It's at `renders/popped/edit/transcripts/<video>.json`. Each word has `start` and `end` timestamps in seconds.

2. **Identify beat boundaries** from the script + transcript. Each beat is roughly 5–10 seconds; first few words of each segment usually signal the boundary ("First, ...", "Second, ...", etc.).

3. **Pick anchor words per beat.** Criteria:
   - Noun, verb, or short noun-phrase (1-2 words max)
   - Replay-worthy — the kind of word a viewer would scrub back to see
   - Distinct from anchors of adjacent beats (don't pick "context" twice)

4. **Choose effect per beat 2/3/4** from the vocabulary based on the anchor's flavor:
   - Caption-style number/fact → `KaraokeCard`
   - Slash-command / function call → `CompactCard`
   - Reset / wipe / clean → `Win95Terminal`
   - Global / world / scale → `AsciiPlanet`

5. **Set window times.** For each effect:
   - `startSec` = anchor word start time minus 0.5–1.0s (for entry runway)
   - `endSec` = anchor word end time plus 0.5–1.0s (for linger)
   - Win95 and Opus need extra linger (1.0s+) — see their per-effect docs

6. **Write the new composition file.** Copy `src/remotion/compositions/PracticeOverlay009.jsx` → `PracticeOverlay010.jsx` (or higher), update the imports in `Root.jsx`, and edit the per-beat props. Keep the structure — just change anchor words + windows.

7. **Wire audio cues.** Use `SkyframeAudioCues`:
   - Bubble at each effect's `startSec * fps` (entry pop)
   - Whoosh at any wipe / pattern-interrupt moment
   - Chime exactly once, at the Opus sparkle peak (typically `(opusStartSec * fps) + 64`)

8. **Render and composite.** See [rules/render-pipeline.md](./rules/render-pipeline.md) for the exact commands.

9. **Spot-check** with FFmpeg keyframe extraction at each beat's mid-point. Verify the hook reads at thumbnail size (frame 36).

10. **Iterate or ship.** If the hero word doesn't hit, adjust window timing or font sizes (10% increments). Don't second-guess the structure.

## Worked example: PracticeOverlay009

`src/remotion/compositions/PracticeOverlay009.jsx` is the canonical implementation against `test007.mp4` (Cloud Code limits). Read it whole — it's ~95 lines and the cleanest reference.

Anchor map for that video:
- Beat 1 (HOOK):    0.0–3.0s  → "burning through cloud code"
- Beat 2 (SUBJECT): 6.0–12s   → "Cloud MD" anchor (KaraokeCard, hero "CLAUDE.md")
- Beat 3 (SUBJECT): 15.5–21s  → "/compact" anchor (CompactCard + TrashCompactor)
- Beat 4 (SUBJECT): 21.5–28s  → "/clear" + "fresh contexts no drift" anchor (Win95Terminal)
- Beat 5 (CTA):     34.5–38s  → "Opus" hero word (OpusGlisten + chime)
- Tail:             38.0–43s  → "for the real WORK" (AsciiPlanet decoration)

The audio cues for that video:
```js
bubbles={[0, 144, 372, 516]}    // frames: intro / Claude.MD / /compact / Win95 entries
whooshes={[547, 912]}           // frames: Win95 wipe / planet entry
chime={892}                     // frame: Opus sparkle peak (~37.17s)
```

## Notes & gotchas

### VP9 alpha preservation (FFmpeg)
On the composite step, `-c:v libvpx-vp9` MUST come **before** the overlay input. Otherwise alpha drops silently and ffprobe lies (`pix_fmt=yuv420p` even when alpha was present).

```bash
ffmpeg -y -i base.mp4 -c:v libvpx-vp9 -i overlay.webm -filter_complex "..."
```

### Pixel font alphabet
`PIXEL_FONT_5x7` covers A-Z, 0-9, `.`, `,`, `!`, `?`, and space. Adding glyphs is straightforward — append to `_helpers.jsx`. Lowercase letters render as their uppercase equivalent (PixelBlockText calls `.toUpperCase()`).

### Public dir size impacts render time
The `public/` directory is currently large (~1.7GB across carousel-video, cartesian-composite, etc.). Each Remotion render copies it into the bundle. Consider trimming or git-ignoring stale render outputs to speed up future renders.

### Don't extract beyond what's used
Resist parameterizing every detail. Skyframe components have intentionally narrow APIs — the visual cohesion comes from staying close to the canonical shapes. If a future video genuinely needs a new effect, ADD a new component to `skyframe/` rather than over-flexing an existing one.

### When to add the 7th effect
A new component graduates into `skyframe/` when:
- It's been used cleanly in 2+ videos as inline code
- The discipline (palette, audio, timing) carries over from the existing 6
- It's anchored to a word, like the others

The Ray-Ban CTA mouse-click pattern (16-bit hand pointer + click sound on IG save) is the next likely candidate — will be added on first cybersec POV video.
