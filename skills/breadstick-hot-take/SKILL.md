---
name: breadstick-hot-take
description: Apply the Hot Take recipe — Skyframe shortform variant for contrarian commentary ("everyone's wrong about X, here's why"). Uses CircleHighlight to literally mark the wrong opinion, TrashCompactor with whoosh to compress it, Win95Terminal for the corrected take. The ONE recipe where a whoosh sound is earned. Triggers on "hot take on this", "contrarian commentary overlay", "everyone's wrong about reel".
metadata:
  tags: skyframe, hot-take, contrarian, motion-graphics, remotion, ray-ban
  parent: breadstick-skyframe-template
  status: DRAFT — awaiting first locked recording
---

## When to use

The operator records a contrarian-commentary reel — "everyone's wrong about X, here's why." Content shape:
- 0–4s: hook + contrarian framing
- 5–10s: the conventional wisdom being countered
- 10–13s: compress / dismiss
- 14–22s: the corrected take
- 24–27s: contrarian CTA

**Canonical composition**: `src/remotion/compositions/PracticeOverlay014.jsx`
**Recipe entry**: `hot-take` in `src/canvas/recipes.js`
**Skill parent**: `breadstick-skyframe-template`

## The 5-beat contract (Hot Take variant)

| Beat | Window | Effect | Hot Take anchor |
|------|--------|--------|-----------------|
| **1** | 0–2.0s | `RayBanIntro` | Contrarian frame — topWord="EVERYONE'S", heroPhrase="WRONG ABOUT", pixelPhrase=domain |
| **2** | 5–10s | `KaraokeCard` | The conventional wisdom — hero word is the wrong-take noun |
| **2.5** | 7.5–10.5s | `CircleHighlight` ★ | Wraps the hero word — operator positions over KaraokeCard hero text via `x/y/w/h` |
| **3** | 10–13s | `TrashCompactor` | Literal "compress the bad take" — earns its whoosh |
| **4** | 14–22s | `Win95Terminal` | The corrected take — `command=/think` or `/reframe`, payoff=corrected sentence |
| **5** | 24–27s | `OpusGlisten` | Contrarian word (the truth's anchor — punchier than the wrong-take word) |

★ = CircleHighlight is the new motion graphic — wraps the wrong word in the conventional KaraokeCard.

### Why these specific locks

- **CircleHighlight + KaraokeCard combo** — the recipe's signature is literally "marking what's wrong before discarding it." CircleHighlight makes the visual gesture of dismissal *before* TrashCompactor executes the dismissal.
- **EXACTLY ONE whoosh** — only the TrashCompactor wipe. This is the ONE recipe in the Skyframe family where whoosh is earned. No carryover whoosh from cybersec or build-day doctrine.
- **chime2 on circle completion** — sharpens the moment of "this is the wrong thing" before the compactor fires.
- **Shortest recipe (~27s)** — hot takes punch fast. Long contrarian reels lose the energy.
- **Win95Terminal as the "corrected take" delivery** — the typewriter cadence reads as "I'm typing the right answer in real time." More authoritative than a KaraokeCard for the truth.

## Audio cue contract

```js
<SkyframeAudioCues
  bubbles={[0, 150, 420]}        // intro / Karaoke / Win95 entries (3 not 4 — Compactor uses whoosh instead)
  whooshes={[300]}               // TrashCompactor wipe ~10s — ONLY whoosh in any recipe
  chime={Math.round(24.0 * 30) + 64}  // Opus sparkle peak
/>
// Plus a separate chime2.mp3 on CircleHighlight completion (~8.5s)
```

## Render commands

Same as Cybersec Truth Bomb — see [breadstick-cybersec-truth-bomb/SKILL.md](../breadstick-cybersec-truth-bomb/SKILL.md) §"Render commands". Composition ID:

```bash
npx remotion render src/remotion/index.jsx PracticeOverlay014 ...
```

## Authoring workflow

1. Read transcript JSON — find anchor times for: wrong-take noun (Beat 2 hero), the wrong sentence verb (Beat 3 compress trigger), the corrected sentence (Beat 4 payoff), contrarian word (Beat 5)
2. Copy `PracticeOverlay014.jsx` → `PracticeOverlay0XX.jsx`
3. Swap KaraokeCard `words[]` + `heroWord` for the wrong take
4. Position CircleHighlight `x/y/w/h` over the KaraokeCard hero word (default `{x:12, y:70, w:36, h:8}` matches `position="bottom-left"` hero word zone — adjust if you change KaraokeCard position)
5. Swap Win95Terminal `command` (thinking verb: `/think`, `/reframe`, `/audit`, `/diff`) and `payoff` (the corrected sentence)
6. Swap OpusGlisten `word` for the contrarian anchor
7. Update `durationInFrames` in Root.jsx
8. Render + composite via standard pipeline

## Discipline rules

- **Always argue against a SPECIFIC take, not a vibe**. "Everyone's wrong" is rhetoric; "Everyone says you need more data" is a take you can counter.
- **CircleHighlight position must match the KaraokeCard position**. If you move KaraokeCard to `bottom-right`, recompute CircleHighlight's `x` (default 12 for bottom-left → ~52 for bottom-right).
- **Win95 payoff is the THESIS** — not a question, not a hedge. Declarative correction.
- **Don't extend past 30s** — hot takes lose punch beyond ~27s. If the corrected take needs more room, the recipe is wrong; consider splitting into a 2-part series.
- **Opus word is the truth's anchor, not the wrong take's anchor** — e.g. for "you need more data" → "QUESTIONS" (the truth) not "DATA" (the wrong take).

## Lock-pass criteria (TBD)

DRAFT until the operator records a contrarian reel through this recipe. The CircleHighlight + TrashCompactor combo is novel — likely needs 2-3 review passes to nail the visual timing.
