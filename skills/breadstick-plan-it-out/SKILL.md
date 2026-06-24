---
name: breadstick-plan-it-out
description: Apply the Plan-It-Out recipe — Skyframe shortform variant for "3 things to do before you X" save-bait listicle content. Use when you have recorded a Ray-Ban POV with a numbered-list script structure (#1, #2, #3) and want the StatCallout-driven receipt-stack treatment. Triggers on "plan-it-out on this", "numbered list overlay", "three things before reel".
metadata:
  tags: skyframe, plan-it-out, listicle, save-bait, motion-graphics, remotion, ray-ban
  parent: breadstick-skyframe-template
  status: DRAFT — awaiting first locked recording
---

## When to use

The operator records a numbered-list reel — typically "3 things to do before you X" or "3 rules for Y." Content shape:
- 0–4s: hook + the promise (what you'll get if you save this)
- 5–22s: three discrete numbered items (each ~5s window)
- 22–31s: tail + save-trigger CTA

**Canonical composition**: `src/remotion/compositions/PracticeOverlay013.jsx`
**Recipe entry**: `plan-it-out` in `src/canvas/recipes.js`
**Skill parent**: `breadstick-skyframe-template`

## The 5-beat contract (Plan-It-Out variant)

| Beat | Window | Effect | Plan-It-Out anchor |
|------|--------|--------|--------------------|
| **1** | 0–2.0s | `RayBanIntro` | Promise hook — heroPhrase="3 THINGS" or "RULES", pixelPhrase=domain ("SHIP AI", "WRITE CODE") |
| **2** | 5–10s | `StatCallout` ★ | Item #1 — `value=1, prefix="#", label="<the rule>"` |
| **3** | 11–16s | `StatCallout` ★ | Item #2 — `value=2, prefix="#", label="<the rule>"` |
| **4** | 17–22s | `StatCallout` ★ | Item #3 — `value=3, prefix="#", label="<the rule>"` |
| **Tail** | 23–27s | `AsciiPlanet` | Short decoration — keep momentum into CTA |
| **5** | 28–31s | `OpusGlisten` | Save-trigger word ("CHECKLIST", "PLAN", "RULES", "STEPS", "LIST") |

★ = StatCallout is the new motion graphic and the load-bearing signature of this recipe.

### Why these specific locks

- **StatCallout ×3 is the entire middle** — the recipe IS the receipt-stack rhythm. No KaraokeCard / Win95 / CompactCard allowed in beats 2-4; they break the cadence.
- **Each count-up has digital-click ticks + chime2 landing** — the audio reinforcement makes each item feel like a deposit.
- **Three items only, not five** — five items overruns the comp timing without making the reel longer. If the script has 5 items, either split into 2 reels or compress 2 items per StatCallout label.
- **Short tail (4s)** — keep the save-trigger arriving while attention is highest. Long tails drop save-rate.
- **Opus word must be a save-trigger** — generic CTA words ("FOLLOW", "WATCH") kill the save:like ratio. The signature word must promise the SAVED thing has value.

## Audio cue contract

```js
<SkyframeAudioCues
  bubbles={[0, 150, 330, 510]}   // intro / Stat1 / Stat2 / Stat3 entries
  whooshes={[]}                  // LOCKED OUT
  chime={Math.round(28.0 * 30) + 64}  // Opus sparkle peak
/>
// Plus per-scene: 2 digital-click ticks during each count + 1 chime2 on each landing (9 extra cues total)
```

The chime2 ×3 on each StatCallout landing is the **most distinctive audio fingerprint** of this recipe.

## Render commands

Same as Cybersec Truth Bomb — see [breadstick-cybersec-truth-bomb/SKILL.md](../breadstick-cybersec-truth-bomb/SKILL.md) §"Render commands". Composition ID swap:

```bash
npx remotion render src/remotion/index.jsx PracticeOverlay013 ...
```

## Authoring workflow

1. Read transcript JSON — find anchor times for each of the 3 items in the script
2. Copy `PracticeOverlay013.jsx` → `PracticeOverlay0XX.jsx`
3. Swap the 3 StatCallout labels with the actual list items (uppercase, ≤30 chars each — labels render small)
4. Adjust each StatCallout's `startSec` to match the spoken item's start (typically 0.5s before)
5. Adjust the OpusGlisten startSec + word for the save-trigger
6. Update `durationInFrames` in Root.jsx
7. Render + composite via standard pipeline

## Discipline rules

- **Exactly 3 items**. Two feels thin, four breaks timing, five requires re-architecting the recipe.
- **StatCallout labels uppercase, ≤30 chars** — the label text is small; long labels wrap and ruin the receipt-stack look.
- **Opus word ≤8 chars** — paired with `fontSize=170, caretHeight=128` (smaller than Cybersec's 194/146 because save-trigger words trend longer).
- **No talking head movement during StatCallouts** — the talent should be still during the visual hit; movement competes.

## Lock-pass criteria (TBD)

DRAFT until you ship a numbered-list reel through this recipe. This is the **highest-leverage recipe for save-rate** — a high save:like ratio is the goal, and this is the format that hits it hardest.
