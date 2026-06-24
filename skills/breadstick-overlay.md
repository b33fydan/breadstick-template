⸻**name: breadstick-overlay**   
**description: Use this skill for talking-head and creator video editing when the goal is a fast, polished, sync-safe review edit with conservative silence trimming, optional false-start cleanup, transparent animated text overlays, LUT application, restrained transitions, and predictable output artifacts.**

**Breadstick Overlay**  
Use this skill when the user wants to turn raw talking-head footage into a reviewable edit quickly without sacrificing lip sync.  
This skill is for practical creator editing, not final-color finishing. The priority order is:

1. sync reliability  
2. conservative dialogue cleanup  
3. readable overlays  
4. restrained visual polish  
5. predictable review output

**Defaults**

* Keep the original source untouched.  
* Default look: LUT \#20.  
* Prefer a single-source timeline render with trim/atrim \+ concat.  
* Preserve source framing unless the user explicitly asks for reframing.  
* Leave natural breathing room around dialogue cuts.  
* If repeat removal is uncertain, keep the take.

**Core Workflow**

1. Inspect media with ffprobe.  
2. Transcribe dialogue with timestamps.  
3. Detect obvious silence gaps and weak fragments.  
4. Build a conservative cut list.  
5. Render from a single source timeline; do not rebuild long dialogue edits from many separately encoded clips when a single-source render is possible.  
6. Apply LUT, transitions, overlays, and audio finishing in the same safe path when practical.  
7. Verify sync before handoff.

**Sync Rules**

Treat sync as a release gate.

* Prefer trim/atrim, setpts/asetpts, and one final concat.  
* Avoid older stitched-segment pipelines for long dialogue edits unless explicitly needed.  
* For longer clips, check sync near the beginning, middle, and end, with extra attention around the 4-6 minute region.

Before finalizing:

* run ffprobe on the output  
* run a full decode check with ffmpeg \-v error \-i output.mp4 \-f null \-  
* export a few spot frames for review if needed

**Editorial Rules**

* Cut obvious silence gaps.  
* Remove false starts and repeated phrases only when confidence is high.  
* Prefer believable pacing over maximum compression.  
* Keep edits conservative by default; this is a rough editor with taste, not a chaos machine.

**Look and Color**

* Default to LUT \#20.  
* If the LUT is too strong for the footage, reduce or blend it rather than swapping looks silently.  
* Say plainly when a grade is review-only versus final-ready.

**Overlays**

Transparent overlays are part of the standard package.  
Prefer:

* short key phrases  
* single words with emphasis  
* simple typed text animation  
* sparse placement  
* phrases pulled from provided brand/style docs when available  
* transparent glass/panel treatments with subtle depth

Avoid:

* cluttered frames  
* too many simultaneous animated elements  
* overlays that cover the mouth/eyes unless explicitly requested  
* opaque cards unless the user explicitly asks for them

When there is no brand guidance, use the simplest readable neutral treatment.  
**Typed Panel Treatment**  
Use this as the default typed overlay style until the user provides a stronger brand system. This treatment was locked after review on the Ray-Ban I LOVE THIS test.

* Keep the panel transparent enough to see footage through it.  
* Add depth with a soft black shadow behind the panel, offset about 8-14px down/right and blurred if the renderer supports it.  
* Add a lighter, tighter shadow behind primary text so white words separate from bright footage.  
* Keep the main phrase large and high-contrast.  
* Place the small subtext about 28-36px above the panel bottom; do not let it sit on the lower border.  
* The subtext should feel tucked under the main phrase, not stuck to the frame edge.  
* Keep grid/border accents crisp and thin.  
* If the panel is over busy footage, increase shadow opacity before increasing panel opacity.

Locked reference geometry for 1216x1616 vertical Ray-Ban-style footage:

* panel: x=42, y=116, w=620, h=216  
* panel fill: dark blue/black at about 80% alpha, still transparent  
* border/grid: blue rgb(0,138,255)  
* panel shadow: black alpha around 90, offset 12px  
* main text: Arial Bold, 86px, x=panel+40, y=panel+50  
* main text shadow: black alpha around 155, offsets (7,9) and (3,4)  
* label: Arial Bold, 28px, x=panel+42, y=panel+28  
* small subtext: Arial, 28px, x=panel+40, y=panel+h-66  
* typing timing: start reveal at 0.50s, finish by 1.55s in a 2.6s overlay

When adapting to other resolutions, scale panel geometry proportionally, then visually verify a cue frame. Keep the text relationship intact before changing colors or animation.  
**Transition Set**

Use a small approved set:

* hard cut  
* short dissolve  
* fade in/out  
* fade through black  
* subtle wipe  
* smooth slide  
* cover/reveal

Do not use flashy transitions unless the user explicitly asks for them. If a transition is more noticeable than the spoken point, tone it down.  
**Tooling Preference**

Prefer deterministic local tooling in this order:

1. ffmpeg / ffprobe  
2. local helper scripts  
3. transcript tooling  
4. GUI automation when it adds clear value

For repeatable edits, prefer scriptable workflows over manual UI work.  
**Standard Artifacts**

Try to produce:

* preview video  
* project note  
* EDL JSON or equivalent timing artifact  
* edit summary  
* transcript cache or packed transcript

Keep output paths predictable and easy to review.  
**Final Handoff**

Call out:

* what was cut  
* whether LUT \#20 was applied at full or reduced strength  
* what overlays/transitions were used  
* whether sync verification passed  
* any remaining risk or uncertainty

