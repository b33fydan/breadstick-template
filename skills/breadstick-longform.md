⸻**name: breadstick-longform**   
**description: Use this skill for longform creator, talking-head, YouTube, course, or commentary video workflows that blend sync-safe dialogue editing with HyperFrames or website-derived motion graphics. Trigger when the user asks to combine breadstick-overlay style silence/repeat cleanup with Apple-style, website-style, Skyframe-style, or HyperFrames overlays, chapter cards, product/site inserts, animated brand UI, captions, LUT/color passes, restrained transitions, and verification.**

**Breadstick Longform**  
**Intent**

Build longform review edits where the dialogue spine stays sync-safe and motion graphics feel designed, branded, and timed to the transcript instead of pasted on afterward.  
This is the bridge between:

* breadstick-overlay for conservative talking-head editing, silence cleanup, LUTs, captions, transparent overlays, and verification.  
* website-to-hyperframes for turning a website, product page, or style reference into DESIGN.md, STORYBOARD.md, and HyperFrames motion direction.  
* hyperframes for HTML-based transparent overlays, chapter cards, UI callouts, animated inserts, captions, and premium motion.

**Skill Routing**

Use the other skills deliberately:

* Use breadstick-overlay first when the input is raw footage that needs silence cuts, repeat cleanup, color, or base captions.  
* If the user supplies an existing base\_edit.mp4, treat it as the locked dialogue spine. Do not recut it unless explicitly asked.  
* Use website-to-hyperframes when a URL, cloned site, captured website, or product page should drive the visual identity.  
* Use hyperframes for motion composition. Follow its visual identity gate, layout-before-animation rule, deterministic timeline rules, and video/audio split.  
* Use hyperframes-website-motion-polish only after the base HyperFrames composition validates and the user wants extra depth, Apple-like polish, glow, halation, or cinematic finish.

For talking-head longform, skip website-to-hyperframes voiceover generation unless the user explicitly asks for narration. The speaker's transcript is the timing source.  
**Workflow**

1. Inspect inputs.  
   * Run ffprobe on the base video.  
   * Locate nearby project.md, edit\_summary.json, edl.json, takes\_packed.md, transcripts, captions, and existing overlays.  
   * Preserve the source and existing base edit.  
1. Establish the dialogue spine.  
   * If raw footage is provided, create the sync-safe edit with breadstick-overlay.  
   * If base\_edit.mp4 is provided, use it as the base layer and build graphics on top.  
   * Keep audio attached to the base edit unless there is a clear reason to remix.  
1. Establish visual identity.  
   * If a website URL or capture is provided, use website-to-hyperframes capture and write DESIGN.md.  
   * If a style file is provided, convert it into a compact DESIGN.md.  
   * If prior project files exist, reuse the closest DESIGN.md or project notes before inventing a new look.  
   * Do not create generic blue-purple tech graphics without a design source.  
1. Pick transcript-timed beats.  
   * Use transcript, SRT, or packed takes to identify high-value moments.  
   * For longform, prefer 3-9 meaningful motion beats rather than constant decoration.  
   * Good beat types: chapter markers, named concepts, quote punches, proof receipts, website/product inserts, timeline callouts, status chips, and edit-boundary accents.  
   * Avoid covering the mouth, eyes, or important hand gestures unless the user requests it.  
1. Write STORYBOARD.md.  
   * Include beat id, start/end time, transcript cue, on-screen text, visual treatment, assets, entrance, hold, exit, and compositing notes.  
   * For website-based graphics, note which site section, asset, or design token each beat uses.  
   * Keep durations tied to transcript meaning, not arbitrary scene lengths.  
1. Build motion.  
   * Build HyperFrames HTML with transparent background when the graphics should overlay footage.  
   * Use the base edit as reference media only when needed for layout; do not bake the base video into a reusable overlay unless the user wants a self-contained HyperFrames project.  
   * Build final layout first, then animate into and out of that layout.  
   * Use deterministic motion only: no random values, infinite loops, async timeline construction, or runtime clock logic.  
1. Composite.  
   * Render transparent overlay assets when possible, then composite them onto the base edit with ffmpeg.  
   * For transparent HyperFrames WebM overlays, decode the overlay input explicitly with \-c:v libvpx-vp9; otherwise ffmpeg may treat the alpha channel as opaque black.  
   * If the local ffmpeg lacks a required text/subtitle filter, render captions/graphics into a transparent overlay track first and then composite.  
   * Keep base audio sync as the release gate. Do not rebuild long edits from separately encoded chunks when a single base video can carry timing.  
1. Verify.  
   * Run HyperFrames validation when HyperFrames is used: npx hyperframes lint and npx hyperframes validate.  
   * Run ffprobe on the final video.  
   * Run a full decode check with ffmpeg \-v error \-i preview.mp4 \-f null \-.  
   * Pull representative cue frames near overlay starts, exits, and the final minute.  
   * Spot-check lip sync near the beginning, middle, and end.

**Output Contract**

Prefer predictable project folders beside the edit:

* base\_edit.mp4 \- locked dialogue spine.  
* preview.mp4 \- review render with graphics.  
* DESIGN.md \- brand/style source of truth.  
* STORYBOARD.md \- transcript-timed motion plan.  
* project.md \- human-readable summary.  
* edit\_summary.json \- timing and output facts.  
* edl.json or equivalent timing artifact when cuts were made.  
* hyperframes/ or motion/ \- HyperFrames composition source.  
* animations/ \- rendered transparent overlays or insert assets.  
* verify/ \- frame pulls, strips, and validation artifacts.

**Longform Style Rules**

* Make graphics feel like editorial emphasis, not a second video fighting the speaker.  
* Prefer transparent overlays, glass panels, UI chips, clean typography, and sparse chapter cards.  
* Use website-derived colors, fonts, spacing, and motion when a site is the design source.  
* Use the locked short-form typed panel style only when it suits the format; longform usually needs quieter lower thirds, chapter cards, and UI callouts.  
* Keep transitions restrained: hard cut, short dissolve, fade, subtle wipe, cover/reveal, or smooth slide.  
* Use edit-boundary flashes only on meaningful section changes or removed-gap clusters.  
* If an overlay is more memorable than the point being spoken, reduce it.

**Reference Cases**

Read references/p1000317-reference.md when using the LUMIX/Skyframe edit as the calibration case or when a user asks for "the April 22 longform thing."  
Read references/motion-brief-template.md when drafting a new DESIGN.md and STORYBOARD.md for a longform HyperFrames overlay pass.  
**Final Handoff**

Report:

* base video used  
* whether the source was untouched  
* what motion beats were added  
* what design source drove the graphics  
* whether HyperFrames validation passed  
* whether final decode and sync checks passed  
* any remaining review risks

