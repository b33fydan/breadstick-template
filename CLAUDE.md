# CLAUDE.md

Guidance for Claude Code working in this repository.

## Development Commands

```bash
# Dev — run BOTH in parallel
npm run dev              # Vite dev server (port 5173/5174)
npm run server           # Express API proxy (port 3001) — required for Anthropic/kie.ai/Blotato

npm run build
npm run lint
npm run remotion:studio  # Beat compositions (port 3333)
```

## Architecture

**Two-view React app** (Vite + React 19, no UI framework) with Express API proxy:

- **Classic View** (`App.jsx`) — Left panel character roster + main panel ingredient selectors + script output. Linear workflow: select character → pick ingredients → generate → copy production prompts.
- **Canvas View** (`src/canvas/CanvasView.jsx`, ~3800 lines) — Node-based visual pipeline using `@xyflow/react` v12. Lazy-loaded. Single-file architecture (all nodes, edges, resolver, panels in one file).
- **Express Proxy** (`server.js`, port 3001) — Forwards Anthropic, kie.ai, Blotato, carousel render, image upload, folder scan, Remotion composite. Reads API keys from request body OR `.env` fallback.

Both views share `src/data/characters.js`, `scriptPrompts.js`, `sora2.js`, `scriptTypes.js`.

### Canvas View Critical Patterns

- **Context pattern, NOT useEffect.** All node components read handlers from `CanvasCtx` (React Context). useEffect on node state caused infinite render loops.
- **NEVER use `useMemo` for `nodeOutputs` consumers** — causes stale data. Compute fresh every render. `nodeOutputs: { [nodeId]: { ...data } }` is the inter-node data flow mechanism — each node writes results keyed by its own ID, downstream nodes trace edges + fallback-scan all nodeOutputs.
- Core nodes (characters, types, generator, outputs) are delete-protected. Spawned ingredient nodes can be deleted.
- `resolvePipeline()` traces edges backward from `generator`/`ugc-gen` nodes to find connected ingredients.

### Four Content Pipelines

1. **UGC Lane**: Character → Ingredients → Script Gen UGC → Clip Splitter → Avatar Frames + UGC Video (Kling 3.0)
2. **Carousel Video Lane**: Niche Script Gen → Title Card + 16-GAMI Art → Frame Sandwich (Kling 3.0) → Carousel + Remotion Compositor
3. **16-Gami Lane**: Niche Script Gen → 16-GAMI Art → Carousel
4. **Video Lane**: Niche Script Gen → 16-GAMI Art → Video Prompt → KIE Img2Vid (Kling 2.6)

### Server Endpoints

- `POST /api/generate` — Anthropic API proxy
- `POST /api/kie/create` — kie.ai task creation (any model; accepts `model` + `input`)
- `GET /api/kie/status/:taskId` — kie.ai task polling
- `POST /api/kie/upload-file` — Upload a local file to kie's own CDN via kie's File Upload API (base64), returns `{ url }`. Primary UGC frame-delivery path; `KIE_UPLOAD_BASE` overridable
- `POST /api/upload-image` — Upload local files to public host (catbox → tmpfiles → 0x0 fallback)
- `GET /api/scan-folder?path=` — Scan local folder for images
- `GET /api/local-image?path=` — Serve local files for canvas preview
- `POST /api/blotato` — CORS proxy for Blotato MCP
- `POST /api/carousel/render` — Run carousel `render.py` pipeline
- `POST /api/remotion/composite` — Remotion video-into-slide compositing
- `GET /carousels/:name/:file` — Static serving for rendered carousel slides

### Remotion

Beat compositions live in `src/remotion/compositions/`. The `CarouselVideoSlide` composition composites video into carousel slide art zones. Entry point: `src/remotion/index.jsx`.

### Canvas Node Aesthetic

All pipeline nodes follow consistent styling: gradient header bar, 8px status dot, bold title + right-aligned badge, `var(--bg-panel)` background, `1.5px` accent border, full-width gradient buttons with `color: #fff`. Node accent colors are mapped in `NODE_ACCENT_COLORS`. Edge glow uses source node's accent color via `PulseEdge`.

### Capability Manifest + MCP

- `npm run manifest` regenerates `breadstick-manifest.json` (routes, comps, nodes, recipes, characters, etc.) — run after adding routes/nodes/comps/recipes/templates.
- `mcp/server.js` is a stdio MCP server exposing `breadstick_capabilities` / `list_characters` / `generate_script` / `query_ledger` / `query_perf` / `call_endpoint`. Auto-registered via `.mcp.json`.
- `generate_script` and `call_endpoint` need `npm run server` running; `call_endpoint` is gated by the manifest's serverRoutes (GET/POST only, no SSE routes — matcher in `mcp/routeGate.js`).
- Smoke test: `node mcp/smoke.mjs`. Unit tests: `npx vitest run mcp/server.test.js`.

### Scoreboard (optional performance telemetry + A/B rotation)

- Optional, code-present, off by default. `server/perfLedger.js` + `server/angleRotation.js` track per-post snapshots and run a deterministic A/B rotation rule (leader 60%, rest split; exploration until ≥3 measured posts per arm). Surfaced via MCP `query_perf`.
- Snapshots write to `data/perf/` (gitignored). To enable rotation, provide your own `pipeline/angles.json` (3 pre-registered arms per lane, gated on `approved: true`).
- Decisions are arithmetic, never LLM calls.

## Environment

- Copy `.env.example` to `.env` and fill in the keys you use (e.g. `ANTHROPIC_API_KEY`, `KIE_API_KEY`). Everything is **BYOK** — keys live only in your `.env` (or the browser UI) and are never sent anywhere except the providers you call.
- API keys can also be entered in the browser UI (persisted to localStorage).
- `GOOGLE_DRIVE_SA_KEY` (optional) is a path to a Service Account JSON you place in `.secrets/` (gitignored).
- ESLint `no-unused-vars` ignores names starting with uppercase or underscore.
- Dark theme: background `#0a0a0f`, text `#e8e8e8`, gold accent `#C9A227`.

---

# Breadstick: AI Influencer Script & Content Factory

## What This Is

An interactive dashboard for AI-influencer content. Pick a character, mix ingredients (pain points, hooks, monetization angles, script types), and generate production-ready scripts + video prompts for an AI video pipeline. Bring your own API keys — nothing leaves your machine except the provider calls you configure.

## Typical Production Stack

Breadstick is tool-agnostic; a common pipeline is:
- **Script generation** — Anthropic (Claude)
- **Voice** — ElevenLabs or any TTS
- **Character image** — any consistent-face image model
- **Animation / lip-sync** — Kling / Higgsfield / Sora-class models via kie.ai
- **Slideshow / papercraft art** — Nano Banana Pro via kie.ai

Flow: Script → voice → character image → lip-sync animation → post.

## Characters

Character data lives in `src/data/characters.js` — each entry has: name, handle, niche, tagline, demographic, optional `cameoName`, avatar description, voice, pain points, hooks, monetization, triggers, CTA style, accent color. Add a character by filling these fields via the "+ Add Character" form — no code changes needed.

The repo ships two **example** UGC characters — Mia Chen (`@mia.ugc`, beauty/skincare) and Jake Rivera (`@jake.ugc`, supplements) — as format references. Replace them with your own roster.

## Sora 2 + UGC Prompt System

- **Cameo system** — characters with a `cameoName` get lean prompts (`@cameoname` + action/setting/lighting/speech/camera/dialogue). Characters without a cameo (or when Kling/Seedance is selected) get the full description injected per clip.
- **Prompt Style toggle** — UGC iPhone (V4 anti-artifact rules) vs Cinematic. V4 enforces iPhone-15-Pro micro-shake, skin-texture preservation, hand safety (no finger warping, palm-open gestures only), restrained performance, and raw iPhone-mic audio realism.
- **Clip modes** — Full Scene (8s clips) or Clip Mode (5s talking + 5s b-roll). Clip Mode tiers: 30s (4T+2B), 45s (5T+4B), 60s (7T+5B). Per-character b-roll libraries live in `sora2.js`.
- **Short-Sentence Rule** — script generation keeps sentences ≤12 words, complete thoughts, never cut mid-sentence by the splitter. Sentences pack greedily into whatever clip duration the splitter targets.

## Known Limitations

- Public image upload for img2vid can be flaky on free hosts; the kie File Upload path (`POST /api/kie/upload-file` → kie's CDN) is the primary frame-delivery route.
- kie.ai CDN links can expire and break embedded carousel image rendering.
- Characters added via the form may need a custom Sora 2 continuity block in `sora2.js`.
- No character edit UI (add/delete only). No script history/favorites.

## Success Bar

Scripts should be good enough to paste straight into a voice generator without editing.
