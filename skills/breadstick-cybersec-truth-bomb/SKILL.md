---
name: breadstick-cybersec-truth-bomb
description: Apply the Cybersec Truth Bomb recipe — a variant of the Skyframe shortform template tuned for cybersecurity-of-AI POV reels. Use when you have recorded a Ray-Ban POV (vertical, 30fps, ≥1080×1920) covering an AI/security topic — vibe-coding risks, prompt injection, supply-chain attacks, agent jailbreaks, etc. — with a transcript and want the canonical 5-beat treatment to ship. Triggers on "cybersec truth bomb on this video", "wire the cybersec POV overlay", "apply the AI security recipe", or whenever the user hands over a cybersec-themed Ray-Ban shortform + transcript and wants the locked template.
metadata:
  tags: skyframe, cybersec, shortform, motion-graphics, remotion, ray-ban
  parent: breadstick-skyframe-template
---

## When to use

The user records a cybersec POV reel (Ray-Ban or talking-head) covering AI-coding security, prompt injection, vibe-coding risk, agent threats, etc. — and wants the locked Cybersec Truth Bomb visual treatment. They'll have:

- A 1080×1920 (or higher, scaled down at composite) portrait MP4
- A transcript JSON with word-level timestamps (ElevenLabs Scribe format, e.g. `testing-vids/edit/transcripts/<name>.json`)
- A script that follows the 6-segment cybersec POV arc: Hook → Threat → Three Pain Bullets → Pivot → Truth Bomb → CTA

**Canonical reference**: `cartesiantest001.mp4` (36.97s, "AI-generated code attack surfaces") — the locked reference cut.
**Canonical composition**: `src/remotion/compositions/PracticeOverlay010.jsx`.

This skill extends `breadstick-skyframe-template`. The Skyframe discipline rules (palette, audio, beat structure) all carry over — this skill adds the cybersec-specific anchor conventions and locks the visual specs after iteration.

## The 5-beat contract (cybersec variant)

Same load-bearing 5-beat structure as Skyframe, with cybersec-specific anchor conventions and one tail decoration:

| Beat | Window | Effect | Cybersec anchor convention |
|------|--------|--------|----------------------------|
| **1** | 0–2.0s | `RayBanIntro` (mandatory, **2s**, paired with FFmpeg gblur 0–2s) | Hook the threat — `heroPhrase` names the risk verb ("SHIPPING BLIND", "RUNNING UNAUDITED", "VIBE CODING"); `pixelPhrase` names the attack surface ("AI CODE", "AGENT TOOLS", "PROMPT CHAIN") |
| **2** | 7–14s | `KaraokeCard` (bottom-left), hero word = the actor | The threat actor in the script — typically "Attackers", "Bots", "LLMs", "Agents". Anchored to the spoken phrase that ends with the threat reveal (e.g. "...attackers love that" at 13.06s) |
| **3** | 15.5–23s | `KaraokeCard` (bottom-right), hero word = the most-quotable noun | The three pain bullets karaoke-revealed as the creator speaks each one. Hero word = the middle bullet's punchword (e.g. "secrets.") for symmetric reveal |
| **4** | 23.5–27.5s (**1s linger past typing**) | `Win95Terminal` `/audit` command | Pivot moment — `command` is a security verb ("/audit", "/scan", "/diff", "/leak"), `payoff` is the truth-bomb sentence verbatim |
| **5** | 34.0–37.0s | `OpusGlisten` (mandatory, **fontSize=194, caretHeight=146**) | The LAST replay-worthy word of the script — typically the CTA closer ("SPACE", "RISKS", "FREE", "BLIND"). Anchored to the final spoken word so the shine + chime + sparkle = closing punchline |
| **Tail** | 30–35s | `AsciiPlanet` | Decoration during the CTA delivery. Anchor: "nobody's talking about" or similar global-scope phrase |

### Why these specific locks

- **RayBanIntro 2s, not 3s**: locked after review — 3s drags on cybersec POV pacing where the threat reveal needs to arrive quickly.
- **OpusGlisten on the LAST word, not the truth-bomb hero**: locked — moving the signature to the closing word makes the chime the punctuation on the whole reel, not the truth-bomb mid-statement. Pairs cleanly with the "Follow for more" CTA energy. The truth-bomb sentence still lands as Win95Terminal payoff (no Opus competition).
- **fontSize=194, caretHeight=146** (90% of length-tier default): Opus signature words in cybersec POVs trend uppercase + 5–8 chars ("SURFACE", "SPACE", "BLIND", "RISKS"). Default tier-0.9 (216) clipped frame edges. 90% rescaling = 194 keeps the word inside the safe zone without losing weight.
- **NO whoosh sounds**: locked — cybersec dialog is dense and the whooshes competed with delivery. Bubbles + single chime carry the audio rhythm.
- **Win95 1s linger past typing**: locked — the truth-bomb payoff needs to read fully before the next beat. Extending endSec by 1s gives the eye time to receive the line.
- **FFmpeg gblur 0–2s**: locked — the RayBanIntro hook needs the blurred base to make the 3D yellow + pixel phrase pop. Gate with `enable='between(t,0,2)'` so it lifts exactly when RayBanIntro fades out.

## Audio cue contract

Locked frame indices @ 30fps for the canonical 1110-frame composition:

```js
<SkyframeAudioCues
  bubbles={[0, 210, 465, 705]}   // intro / Karaoke₁ / Karaoke₂ / Win95 entries
  whooshes={[]}                  // LOCKED OUT for cybersec — too noisy with dense dialog
  chime={1084}                   // Opus sparkle peak at (34.0 * 30) + 64
/>
```

When porting to a new video with different anchor windows:
- Each bubble = `Math.round(beatStartSec * fps)` for beats 1–4
- Chime = `Math.round(opusStartSec * fps) + 64` (frame 64 of the OpusGlisten window = sparkle peak)
- Beats 5 (Opus) and tail (AsciiPlanet) get NO bubble — chime replaces Opus's entry sound, AsciiPlanet enters silently

## Render commands (LOCKED)

### Step 1 — Remotion render the overlay

From the project root:
```bash
npx remotion render src/remotion/index.jsx PracticeOverlay010 \
  "testing-vids/edit/overlays/<name>_overlay.webm" \
  --codec=vp9 --pixel-format=yuva420p --image-format=png \
  --frames=0-<lastFrame>
```

Where `<lastFrame>` = `Math.floor(videoDurationSec * 30) - 1`. For a 36.975s source, `lastFrame=1109` (1110 frames).

### Step 2 — FFmpeg composite (single pass)

Critical rules:
- `-c:v libvpx-vp9` MUST precede `-i overlay.webm` or VP9 alpha silently drops
- LUT path with spaces/`#` must be sanitized — copy to `.tmp/lut20.cube` first
- `gblur=sigma=22:enable='between(t,0,2)'` applied AFTER `lut3d` so blur affects the graded base
- Source audio at 1.0, overlay audio (cues) at 0.8

```bash
cd "<project-root>"
ffmpeg -y \
  -i "testing-vids/<source>.mp4" \
  -c:v libvpx-vp9 -i "testing-vids/edit/overlays/<name>_overlay.webm" \
  -filter_complex "[0:v]scale=1080:1920,lut3d=.tmp/lut20.cube,gblur=sigma=22:enable='between(t,0,2)'[base];[base][1:v]overlay=0:0:eof_action=pass[out];[0:a]volume=1.0[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]" \
  -map "[out]" -map "[aout]" \
  -c:v libx264 -preset fast -crf 18 \
  -c:a aac -b:a 256k -ac 2 \
  -movflags +faststart \
  "testing-vids/edit/<name>_cybersec_truth_bomb.mp4"
```

If `.tmp/lut20.cube` is missing, first run:
```bash
mkdir -p .tmp && cp "pipeline/luts/default.cube" ".tmp/lut20.cube"
```

### Step 3 — Verify sync

```bash
ffprobe -v error -show_entries stream=width,height,duration,nb_frames -of json "<output>.mp4"
ffmpeg -v error -i "<output>.mp4" -f null -
```

Both must exit cleanly. Frame count should match overlay frame count.

### Step 4 — Upload to Drive

```bash
gws drive +upload "<output>.mp4"
```

Returns `{id, name, mimeType}`. Share link: `https://drive.google.com/file/d/<id>/view`.

## Authoring workflow

When the user hands over a new cybersec POV recording + transcript:

1. **Read the transcript JSON** — find word-level timings for anchor words
2. **Identify the 6-segment arc**: Hook (0–7s) / Threat (7–14s) / Three Bullets (14–23s) / Pivot (23–24s) / Truth Bomb (24–28s) / CTA (29–end)
3. **Copy `PracticeOverlay010.jsx` → `PracticeOverlay011.jsx`** (or higher), update:
   - File header comment (source video, transcript, beat anchor times)
   - Beat 1 props: `topWord`, `heroPhrase`, `midWord`, `pixelPhrase`, `subtitle`
   - Beat 2 props: `eyebrow`, `words[]`, `heroWord` (matches one in `words`)
   - Beat 3 props: same shape, three pain bullets compressed into 6–8 karaoke words
   - Beat 4 props: `command` (security verb), `payoff` (truth-bomb sentence verbatim)
   - Beat 5 props: `word` (the LAST spoken word, uppercase, 4-8 chars) — keep `fontSize={194}` and `caretHeight={146}`
   - Audio cues: bubble frames at each beat start * 30, chime frame at opus start * 30 + 64
4. **Register** in `src/remotion/Root.jsx` with `durationInFrames=<frames>`, `fps=30`, `width=1080`, `height=1920`
5. **Render** + **composite** per the commands above
6. **Verify + upload** per steps 3–4
7. **Spot-check** at frame 30 (1.0s, RayBanIntro mid-anim) for thumbnail readability

## Discipline rules (cybersec-specific)

These extend the Skyframe template's rules — break only with strong reason:

### Hero phrase patterns

Beat 1 `heroPhrase` should follow the verb-first pattern:
- **Risk verb**: "SHIPPING BLIND", "VIBE CODING", "RUNNING WILD", "TRUSTING AI"
- **Threat noun**: "AI CODE", "AGENT TOOLS", "PROMPT CHAIN", "SUPPLY CHAIN"

Never use the brand name or the channel handle here — that's CTA territory.

### Truth-bomb sentence rules

Beat 4 `payoff` should be the most-screenshotable line of the script. Criteria:
- One sentence, ≤9 words
- Declarative (no question marks)
- Contains a security primitive ("attack surface", "blast radius", "trust boundary", "kill chain", "lateral move")
- Ends with a period, not an ellipsis — finality matters

### Opus word selection

Beat 5 `word` is the LAST spoken word of the script. Cybersec POVs typically end with:
- A space/domain word ("space", "scene", "field", "stack")
- A directive ("now", "today", "first", "fast")
- A risk noun ("risks", "threats", "blast")

Avoid the literal CTA verb ("follow", "save", "share") — too generic for the signature moment.

### Tail decoration

`AsciiPlanet` is the locked tail for cybersec. The spinning ASCII disc reads as "global / pervasive / everywhere" — matches the cybersec scope tone. Don't substitute unless explicitly approved.

## Known gotchas

- **LUT path collision**: `pipeline/luts/default.cube` contains spaces and `#`. The `#` is interpreted as a filter-graph comment by ffmpeg. ALWAYS copy to `.tmp/lut20.cube` before render.
- **Composition duration vs video duration**: Set `durationInFrames` to match the source video exactly. If Opus window extends past video end (e.g. Opus 34–37s on a 36.97s video), the final 0.025s of the container fade is truncated — acceptable, hard cut on Opus at full opacity is cinematic.
- **Win95Terminal payoff length**: long payoffs (>40 chars) overflow the terminal pane. The typed "Every line is an attack surface." (32 chars) is at the upper bound — go shorter if the verb is longer than "/audit".

## Worked example: PracticeOverlay010 (cartesiantest001)

`src/remotion/compositions/PracticeOverlay010.jsx` is the canonical implementation against `cartesiantest001.mp4` (AI-generated code attack surfaces). Read it whole — ~80 lines, the cleanest cybersec reference.

Anchor map:
- Beat 1 (HOOK):    0.0–2.0s   → "SHIPPING BLIND / AI CODE"
- Beat 2 (THREAT):  7.0–14s    → hero "Attackers" (anchor: "attackers love that" 13.06s)
- Beat 3 (BULLETS): 15.5–23s   → hero "secrets." (anchor: broken auth 16.78s, hardcoded secrets 18.64s, insecure deps 20.28s)
- Beat 4 (PIVOT):   23.5–27.5s → "/audit" → "Every line is an attack surface." (anchor: "Here's the thing" 24.0s)
- Beat 5 (CTA):     34.0–37s   → "SPACE" (anchor: last spoken word "space" 36.0s)
- Tail:             30.0–35s   → AsciiPlanet (anchor: "nobody's talking about" 33.5s)

Audio:
```js
bubbles={[0, 210, 465, 705]}   // intro / Karaoke₁ / Karaoke₂ / Win95 entries
whooshes={[]}                  // LOCKED OUT
chime={1084}                   // Opus sparkle peak ~36.13s
```

Output: `testing-vids/edit/cartesiantest001_cybersec_truth_bomb_v3.mp4`
Drive: uploaded via `gws drive +upload` (returns the file id + share link).
