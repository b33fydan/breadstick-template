# Pop sounds for PopBeats

Three placeholder pops synthesized with FFmpeg on 2026-05-03. They work, but they're not curated — replace them with CC0 samples from Freesound / BBC Sound Effects / Mixkit when you find ones that sound right for your edits.

## What's here

| File | Synthesis | Character |
|---|---|---|
| `subtle.mp3` | 900 Hz sine, 40ms, fade out 35ms, vol 0.7 | gentle UI tap |
| `sharp.mp3` | white noise 25ms, highpass 2 kHz, fade out 20ms, vol 0.8 | percussive click |
| `soft.mp3` | 350 Hz sine, 80ms, fade in/out, vol 0.6 | air-pop, breathy |

## Replacing them

Drop a new `.mp3` into this folder with the same filename to swap. PopBeats picks them up automatically — no code change needed. Or use `--sound <path/to/your/pop.mp3>` to point at any file outside this folder.

Recommended sources:
- https://freesound.org/ (filter for CC0)
- https://mixkit.co/free-sound-effects/click/
- https://www.zapsplat.com/sound-effect-categories/ (free with attribution)

Pick by ear, not by description — what sounds right against your specific edits is what wins.
