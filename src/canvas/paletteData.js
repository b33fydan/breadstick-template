// src/canvas/paletteData.js
// Static node-palette catalog + the React-key derivation NodePalette renders
// with. Split out of CanvasView.jsx so the key-collision regression test can
// import real palette data without mounting the whole component tree.
export const PALETTE_NODES = [
  // Script & Strategy
  { type: 'generator', label: 'Script Generator', icon: 'G', desc: 'Generate scripts from ingredients', color: '#C9A227', category: 'Script' },
  { type: 'ugc-gen', label: 'Script Gen (UGC)', icon: 'U', desc: 'AI influencer UGC scripts', color: '#e0922f', category: 'Script' },
  { type: 'niche-gen', label: 'Script Gen (Niche)', icon: 'N', desc: 'Visual storytelling scripts', color: '#9b59b6', category: 'Script' },
  { type: 'ares-gen', label: 'Script Gen (ARES)', icon: '⟁', desc: 'ARES corpus scripts: failure-as-feature, research, or first-person framing across 14 named beats', color: '#6366f1', category: 'Script' },
  { type: 'vid-prompt', label: 'Video Prompt', icon: '▶', desc: 'Motion prompts for img2vid', color: '#ff6b35', category: 'Script' },
  { type: 'qc-gate', label: 'QC Gate', icon: '⬢', desc: 'ARES-style injection + structural validator', color: '#8b5cf6', category: 'Script' },
  { type: 'group-script-types', label: 'Script Types Group', icon: '⊟', desc: 'Group of 5 script-type selectors (Classic flow ingredient)', color: '#5b8def', category: 'Script' },
  { type: 'group-conversion-levels', label: 'Conversion Levels Group', icon: '⊟', desc: 'Group of 3 conversion-level selectors (Classic flow ingredient)', color: '#c27adb', category: 'Script' },
  { type: 'output', label: 'Custom Output', icon: 'O', desc: 'Display prompt output', color: '#00FFFF', data: { label: 'Custom Output', icon: 'O' }, category: 'Script' },
  { type: 'output', label: 'ElevenLabs Output', icon: 'V', desc: 'Voice-script display window', color: '#00FFFF', data: { label: 'ElevenLabs', icon: 'V' }, category: 'Script' },
  { type: 'output', label: 'Caption Output', icon: 'C', desc: 'Social-caption display window', color: '#00FFFF', data: { label: 'Caption', icon: 'C' }, category: 'Script' },

  // Image Generation
  { type: 'gami', label: '16-GAMI ARES', icon: '◆', desc: 'ARES agent origami prompts', color: '#C9A227', category: 'Image' },
  { type: 'gami-art', label: '16-GAMI Art', icon: '◇', desc: 'Script-driven origami art', color: '#e8b830', category: 'Image' },
  { type: 'image-2', label: 'Image-2', icon: '▦', desc: 'GPT Image-2 — typography + 16-GAMI toggle', color: '#10a37f', category: 'Image' },
  { type: 'pixel-forge', label: 'Pixel Forge', icon: '◾', desc: 'Midjourney pixel-art prompt generator', color: '#f97316', category: 'Image' },
  { type: 'sprite-forge', label: '16-gami Sprite Forge', icon: '⚒', desc: '3-mode sectioned 16-gami builder · Nano Banana or Image-2', color: '#a0392e', category: 'Image' },
  { type: 'sf-palette',        label: 'SF Palette',        icon: '🎨', desc: 'Sprite Forge chunk — wire a colour palette into Sprite Forge. Drop, fill, connect to the chunks-in handle.', color: '#a0392e', category: 'Image' },
  { type: 'sf-hero-identity',  label: 'SF Hero Identity',  icon: '🦸', desc: 'Sprite Forge chunk — title, subtitle, hero desc, emblem for hero-card mode',          color: '#a0392e', category: 'Image' },
  { type: 'sf-taglines',       label: 'SF Taglines',       icon: '🏷️', desc: 'Sprite Forge chunk — red + navy taglines + corner badge for hero-card mode',        color: '#a0392e', category: 'Image' },
  { type: 'sf-world-identity', label: 'SF World Identity', icon: '🌍', desc: 'Sprite Forge chunk — theme, tone, centerpiece, app title for world-build mode',      color: '#a0392e', category: 'Image' },
  { type: 'sf-stats',          label: 'SF Stats',          icon: '📊', desc: 'Sprite Forge chunk — 5 stat bars (label · color) for hero-card mode',                color: '#a0392e', category: 'Image' },
  { type: 'sf-sidebar',        label: 'SF Sidebar',        icon: '📋', desc: 'Sprite Forge chunk — 4 sidebar stat-icons (label · icon) for hero-card mode',        color: '#a0392e', category: 'Image' },
  { type: 'sf-party',          label: 'SF Party',          icon: '👥', desc: 'Sprite Forge chunk — 4 party member descriptions for hero-card mode',                color: '#a0392e', category: 'Image' },
  { type: 'sf-actions',        label: 'SF Actions',        icon: '⚔️', desc: 'Sprite Forge chunk — 4 action buttons (label · icon) for hero-card mode',           color: '#a0392e', category: 'Image' },
  { type: 'sf-asset-bands',    label: 'SF Asset Bands',    icon: '🎴', desc: 'Sprite Forge chunk — theme + dynamic band rows (name · items) for asset-gallery',    color: '#a0392e', category: 'Image' },
  { type: 'title-card', label: 'Title Card', icon: '✉', desc: '16-gami text-on-paper 1st frames', color: '#7ed957', category: 'Image' },
  { type: 'avatar-frame', label: 'Avatar Frame', icon: '🖼', desc: 'Character reference image', color: '#1abc9c', category: 'Image' },
  { type: 'char-scene', label: 'Character Scene', icon: '🎭', desc: 'Same character, new scene (NB2 / GPT I2I)', color: '#e056a0', category: 'Image' },

  // Video Generation
  { type: 'kie', label: 'KIE.AI', icon: 'K', desc: 'Generate video via Sora 2', color: '#e85d75', category: 'Video' },
  { type: 'kie-img2vid', label: 'KIE Img2Vid', icon: 'K', desc: 'Image-to-video generation', color: '#e85d75', category: 'Video' },
  { type: 'clip-splitter', label: 'Clip Splitter', icon: '✂', desc: 'Split script into 9s clips', color: '#e74c3c', category: 'Video' },
  { type: 'ugc-video', label: 'UGC Video', icon: '🎬', desc: 'Batch Kling 3.0 from clips+frames', color: '#e85d75', category: 'Video' },
  { type: 'frame-sandwich', label: 'Frame Sandwich', icon: '🥪', desc: '1st + last frame → Kling 3.0', color: '#00bfa5', category: 'Video' },
  { type: 'arecibo-recap', label: 'Arecibo Recap', icon: '📡', desc: 'Weekly transmission — 943-bit cipher grid + decoder video', color: '#2ee6a6', category: 'Video' },
  { type: 'conductor', label: 'Conductor', icon: '🎼', desc: 'Compose a pipeline from plain English — Opus 4.8 stages ghost nodes for your review (drag to add)', color: '#C9A227', category: 'Substrate' },

  // Compositing & Effects
  { type: 'chroma-composite', label: 'Chroma Composite', icon: '🎭', desc: 'Character over slide (chromakey + overlay)', color: '#ff69b4', category: 'Compositing' },
  { type: 'chroma-motion', label: 'Chroma Motion', icon: '🎬', desc: 'Animated character over slide (Remotion Tier 2)', color: '#ff1493', category: 'Compositing' },
  { type: 'chroma-stylize', label: 'Chroma Stylize', icon: '🎨', desc: 'Greenscreen video → glitch / pixel / CRT effect → transparent .webm for Cartesian', color: '#ff6b35', category: 'Compositing' },
  { type: 'live-preview', label: 'Live Preview', icon: '◉', desc: 'Wire Terminal stdout/urls/cwd → iframe / log / file viewer. Closes the closed-container UX', color: '#34d399', category: 'Substrate' },
  { type: 'hyperframes', label: 'Hyperframes', icon: '▷', desc: 'HTML+GSAP overlay burn on video clips', color: '#00bcd4', category: 'Compositing' },
  { type: 'broll', label: 'B-Roll', icon: '◫', desc: 'Splice full-frame motion-graphic cuts into a talking-head', color: '#ff9500', category: 'Compositing' },
  { type: 'video-source', label: 'Video Source', icon: '▶', desc: 'Pick a local video file or paste a URL — feeds downstream video nodes', color: '#3b82f6', category: 'Compositing' },
  { type: 'cartesian', label: 'Cartesian Composer', icon: '⊞', desc: 'Timed overlays at exact x/y/w/h coordinates (% of frame) over a base video', color: '#a855f7', category: 'Compositing' },
  { type: 'concept-composer', label: 'Concept Composer', icon: '✋', desc: 'Realtime hand-tracked stage with MediaPipe Hands + Three.js. Record yourself wielding ARES props (Cube/Disc/Wire/Scale in later phases). Output webm wires into Cartesian / Stack / Postiz.', color: '#06b6d4', category: 'Compositing' },
  { type: 'prop-lab', label: 'Prop Lab', icon: '✨', desc: 'Ideate ARES Concept Composer props in plain language. Three input modes (Quick/Pinned/Detailed) + Claude returns a 6-element spec card. Library of entries persists to localStorage across sessions; copy build-prompt to fire a fresh build chat.', color: '#fbbf24', category: 'Compositing' },
  { type: 'asset-sequence', label: 'Asset Sequence', icon: '☰', desc: 'Labeled list of typed assets — wires into Cartesian Composer as a content pool', color: '#14b8a6', category: 'Compositing' },
  { type: 'motion-bake', label: 'Motion Bake', icon: '✦', desc: 'Script → per-beat motion graphics → asset pool (Niche Script Gen → Cartesian)', color: '#7ed957', category: 'Compositing' },
  { type: 'skyframe-picker', label: 'Skyframe Picker', icon: '✺', desc: 'Operator picks the 6 taste-baked Skyframe effects → transparent webms → Cartesian content-pool', color: '#FFD24A', category: 'Compositing' },
  { type: 'ffmpeg-grade', label: 'Color Grade', icon: '🎨', desc: 'FFmpeg color grading', color: '#f4a261', category: 'Compositing' },
  { type: 'remotion-comp', label: 'Remotion Compositor', icon: 'R', desc: 'Video-in-slide compositor', color: '#4ecdc4', category: 'Compositing' },
  { type: 'pop-beats', label: 'Pop Beats', icon: '◉', desc: 'Inject pop sounds at motion-graphic event timestamps (FFmpeg post-stitch)', color: '#a3e635', category: 'Compositing' },
  { type: 'stack-video', label: 'Stacked Video', icon: '☷', desc: 'vstack/hstack composer for split-frame edits (top+bottom or left+right)', color: '#fb7185', category: 'Compositing' },

  // Distribution
  { type: 'carousel', label: 'Carousel', icon: '▤', desc: 'Skyframe branded slides', color: '#00ffff', category: 'Distribution' },
  { type: 'blotato', label: 'Blotato', icon: 'B', desc: 'Post to social platforms', color: '#00ffff', category: 'Distribution' },
  { type: 'postiz', label: 'Postiz', icon: 'P', desc: 'Schedule, draft, or post-now to 28+ socials via api.postiz.com/public/v1 — wire caption from any text source and media URL from Cartesian/Stack/Suno. Cloud or self-hosted (POSTIZ_BASE_URL env)', color: '#a78bfa', category: 'Distribution' },

  // PRD Maker — 6 lens nodes (single component, distinct via data.lens) + prompt card + chat.
  // Operator workflow: drop all 6 lenses, fill them, wire them into PRD Chat, hit Generate.
  { type: 'prd-lens', label: 'Problem Lens', icon: '◉', desc: 'Pain + evidence it hurts', color: '#ef4444', data: { lens: 'PROBLEM' }, category: 'PRD Maker' },
  { type: 'prd-lens', label: 'Market Lens', icon: '◉', desc: 'Sentiment, demand, competition', color: '#eab308', data: { lens: 'MARKET' }, category: 'PRD Maker' },
  { type: 'prd-lens', label: 'User Lens', icon: '◉', desc: 'Specific persona, context, behavior', color: '#3b82f6', data: { lens: 'USER' }, category: 'PRD Maker' },
  { type: 'prd-lens', label: 'Vision Lens', icon: '◉', desc: 'The big idea, desired experience', color: '#a855f7', data: { lens: 'VISION' }, category: 'PRD Maker' },
  { type: 'prd-lens', label: 'Build Lens', icon: '◉', desc: 'Functional specs + tech constraints', color: '#10b981', data: { lens: 'BUILD' }, category: 'PRD Maker' },
  { type: 'prd-lens', label: 'Boundary Lens', icon: '◉', desc: 'Non-goals, risks, open questions', color: '#f97316', data: { lens: 'BOUNDARY' }, category: 'PRD Maker' },
  { type: 'prd-prompt', label: 'PRD Prompt Card', icon: '✎', desc: 'Synthesis prompt — read-only reference', color: '#0ea5e9', category: 'PRD Maker' },
  { type: 'prd-chat', label: 'PRD Chat', icon: '⚡', desc: 'Wire 6 lenses → pick model → Generate PRD (Anthropic or OpenAI)', color: '#f59e0b', category: 'PRD Maker' },
  { type: 'prd-design', label: 'Design Source', icon: '◈', desc: 'JSON tokens for the PRD aesthetic compass — palette, typography, tone', color: '#ec4899', category: 'PRD Maker' },
  { type: 'prd-render', label: 'PRD Render', icon: '◐', desc: 'Wire PRD Chat + Design Source → branded HTML preview + download/print', color: '#22c55e', category: 'PRD Maker' },

  // Substrate — the harness layer per project_breadstick_harness_doctrine.
  // Foundation for Block 2-7 of the endgame PRD: command exec, terminal,
  // mind-wire (voice/notes), Suno music. Operator-controlled execution
  // primitives that other nodes wire INTO.
  { type: 'cmd-runner', label: 'Command Runner', icon: '$_', desc: 'Spawn a shell command with live stdout/stderr streaming (ffmpeg, npm, pipeline-cli, git). Tier 1 — no PTY, no interactive prompts', color: '#4ade80', category: 'Substrate' },
  { type: 'terminal', label: 'Terminal', icon: '▮', desc: 'Real PTY terminal — runs anything a real shell runs (Claude Code, Codex, htop, vim, git log w/ ANSI colors). Localhost-only, token-gated', color: '#10b981', category: 'Substrate' },
  { type: 'suno', label: 'Suno (Music)', icon: '♫', desc: 'Generate music via kie.ai Suno — wire any text-emitting node as the prompt seed, pick genre+mood, get an mp3 you can drop into Cartesian as audio bed', color: '#fb923c', category: 'Substrate' },
  { type: 'mindwire', label: 'Mind Wire', icon: '◊', desc: 'Wrap voice memo transcripts, Maestro session logs, Obsidian notes, or freeform paste as a canvas-wireable text source. Feed your mind into any pipeline', color: '#38bdf8', category: 'Substrate' },
  { type: 'script-pinner', label: 'Script Effect Pinner', icon: '📌', desc: 'Operator-pinned motion graphics — wire script + transcript, pick word + effect from a 10-effect palette, transcript word-timestamps give EXACT timing. Emits beats[] + renders transparent .webm overlay for Cartesian/Stack compositing. Operator precision without per-overlay x/y/t math', color: '#fbbf24', category: 'Substrate' },
  { type: 'audio-viz', label: 'Audio Visualizer', icon: '◑', desc: 'ASCII + CRT + dither music viz for Suno tracks. 4 styles (mirror-columns / pixel-city / spectrum / pulsing-planet), 5 accent presets (white/amber/green/magenta/cyan). Brand-locked: every output gets CRT scanlines + Bayer dither + phosphor glow + vignette. Pure ASCII primitives, VT323 font. Wire Suno audio in → render mp4 with viz + sound baked', color: '#a78bfa', category: 'Substrate' },
  { type: 'bokeh', label: 'Bokeh', icon: '◯', desc: 'Subject isolation + gaussian-blurred background. MediaPipe Selfie Segmentation per-frame + OpenCV composite, audio muxed back. ~8 fps at 720p on CPU (15s clip ≈ 53s render). Wire video in, get sharp-subject + blurred-bg composite out. Best for talking-head / POV content with a human subject', color: '#a78bfa', category: 'Substrate' },
];

// React key for one palette item — a static PALETTE_NODES entry or a dynamic
// character card built in CanvasView.jsx (type 'character', data: { characterId }).
// Regression guard (2026-06-12): keying on type + data.label alone collided —
// every character card hashed to 'character:' and all six prd-lens entries
// (data carries only { lens }) to 'prd-lens:'. characterId, then top-level
// label, are what actually distinguish same-type entries. paletteData.test.js
// fails if a new entry re-introduces a collision.
export function paletteItemKey(n) {
  return `${n.type}:${n.data?.characterId || n.label || n.data?.label || ''}`;
}
