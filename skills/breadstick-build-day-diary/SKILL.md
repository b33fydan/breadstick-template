---
name: breadstick-build-day-diary
description: Apply the Build-Day Diary recipe — Skyframe shortform variant for "I shipped X today" builder content. Use when the operator has recorded a Ray-Ban POV or desk-cam showing a tool/feature they just built and wants the canonical terminal-heavy builder treatment with LowerThirdChyron naming, CompactCard command demo, Win95Terminal output, and OpusGlisten on the impact verb. Triggers on "build-day diary on this", "wire the build-day overlay", or whenever you hand over a daily-shipped recording.
metadata:
  tags: skyframe, build-day, shortform, motion-graphics, remotion, ray-ban
  parent: breadstick-skyframe-template
  status: DRAFT — awaiting first locked recording
---

## When to use

The operator records a "I built X today" reel. Content shape:
- 0–8s: hook + tool/feature name reveal
- 8–22s: command demo + build output / breakthrough
- 22–32s: impact / what it unlocks + CTA

**Canonical composition**: `src/remotion/compositions/PracticeOverlay012.jsx`
**Recipe entry**: `cybersec-truth-bomb`'s sibling in `src/canvas/recipes.js` (id: `build-day-diary`)
**Skill parent**: `breadstick-skyframe-template`

## The 5-beat contract (Build-Day variant)

| Beat | Window | Effect | Build-Day anchor |
|------|--------|--------|------------------|
| **1** | 0–2.0s | `RayBanIntro` | "I SHIPPED TODAY / <TOOL>" — celebratory hook |
| **2** | 5–12s | `LowerThirdChyron` ★ | Naming moment — eyebrow=domain ("ENGINE", "TOOL"), name=actual name, subtitle=one-line value |
| **3** | 13–20s | `CompactCard` | Command demo — `command=/run`, `subtitle=what it does` |
| **4** | 21–28s | `Win95Terminal` | Build output / receipt — `command=/render` or `/build`, payoff="<actual result>" |
| **Tail** | 29–34s | `AsciiPlanet` | System/pipeline energy decoration |
| **5** | 34–37s | `OpusGlisten` | Impact verb ("SHIPPED", "BUILT", "DROPPED", "WIRED") |

★ = the new motion graphic that's the signature of this recipe.

### Why these specific locks

- **LowerThirdChyron is the signature** — naming the tool *editorially* (not in dialog) makes the reel feel like a product reveal, not a tutorial. This is what differentiates Build-Day from Cybersec.
- **mouse-click sound on chyron entry** — replaces a generic bubble, gives the naming moment a "this is the thing" feel.
- **NO whoosh** — same dialog-density rule as Cybersec Truth Bomb.
- **Opus on the impact verb** — builder reels close on the action, not the artifact.

## Audio cue contract

```js
<SkyframeAudioCues
  bubbles={[0, 150, 390, 630]}   // intro / Chyron / Compact / Win95 entries
  whooshes={[]}                  // LOCKED OUT
  chime={1084}                   // Opus sparkle peak
/>
// Plus a separate mouse-click.mp3 played on the LowerThirdChyron slide-in
```

## Render commands

Same as Cybersec Truth Bomb — see [breadstick-cybersec-truth-bomb/SKILL.md](../breadstick-cybersec-truth-bomb/SKILL.md) §"Render commands". The only swap is the composition ID:

```bash
npx remotion render src/remotion/index.jsx PracticeOverlay012 ...
```

LUT + gblur 0–2s + VP9 alpha rule all carry over unchanged.

## Authoring workflow

1. Read transcript JSON — find anchor times for: tool name (Beat 2), command word (Beat 3), output sentence (Beat 4), impact verb (Beat 5)
2. Copy `PracticeOverlay012.jsx` → `PracticeOverlay0XX.jsx`, swap:
   - Beat 1 `RayBanIntro` props (heroPhrase, pixelPhrase, subtitle)
   - Beat 2 `LowerThirdChyron` props (eyebrow, name, subtitle)
   - Beat 3 `CompactCard` props (command, subtitle)
   - Beat 4 `Win95Terminal` props (command, payoff)
   - Beat 5 `OpusGlisten` word
3. Update `durationInFrames` in Root.jsx to match the source video
4. Render + composite via the standard Skyframe pipeline
5. Verify + upload to Drive

## Discipline rules

- Use **only when actually showing a terminal / pipeline**. Abstract "I had an idea" content belongs in a different recipe.
- The LowerThirdChyron `name` should be a **proper noun** (tool name, feature name) — never a verb or a description.
- The Win95Terminal `payoff` is a **receipt of what happened** — past tense, factual. Not a value claim.

## Lock-pass criteria (TBD)

This recipe is a DRAFT until you record a build-day reel against it and sign off. Cybersec Truth Bomb required 3 review passes — this one likely needs 2 (smaller surface area, less novelty).
