// mcp/server.js — Breadstick MCP server (stdio).
//
// Lets Claude Code operate Breadstick natively over the Model Context
// Protocol. Eight tools:
//
//   breadstick_capabilities  read breadstick-manifest.json (section names +
//                            counts, or one section in full)
//   list_characters          default roster from src/data/characters.js
//   generate_script          assemble the real classic-view prompts and POST
//                            them through /api/generate (needs npm run server)
//   query_ledger             activity ledger events straight from disk —
//                            works with the server down
//   query_perf               performance-ledger snapshots straight from disk
//   call_endpoint            generic proxy to localhost:3001, gated by the
//                            manifest's serverRoutes (see mcp/routeGate.js)
//   run_job                  enqueue a footage job on the server job queue
//                            (POST /api/jobs); returns a ticket {id,status}
//   job_status               read job-queue state (GET /api/jobs[/:id])
//
// Registered for auto-discovery via .mcp.json at the repo root. Never write
// to stdout directly — stdout is the JSON-RPC channel; diagnostics go to
// stderr.


import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { gateRequest } from './routeGate.js';
import { runJob, jobStatus } from './jobTools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MANIFEST_PATH = join(ROOT, 'breadstick-manifest.json');
const API_BASE = 'http://localhost:3001';

/* ===== helpers ===== */

// Every tool returns through these two so the content shape stays uniform:
// one JSON text block, isError set on failures.
function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function loadManifest() {
  let raw;
  try {
    raw = await readFile(MANIFEST_PATH, 'utf8');
  } catch {
    throw new Error('breadstick-manifest.json not found — generate it first: npm run manifest');
  }
  return JSON.parse(raw);
}

async function loadCharacters() {
  const mod = await import('../src/data/characters.js');
  return mod.defaultCharacters;
}

// Distinguish "Express server isn't up" from genuine request failures so the
// caller gets an actionable message instead of a bare ECONNREFUSED.
function isConnRefused(err) {
  return err?.code === 'ECONNREFUSED' ||
    err?.cause?.code === 'ECONNREFUSED' ||
    /ECONNREFUSED|fetch failed/i.test(err?.message || '');
}

const SERVER_DOWN = 'Breadstick server not running — start with: npm run server';

/* ===== server + tools ===== */

const server = new McpServer({ name: 'breadstick', version: '1.0.0' });

server.registerTool(
  'breadstick_capabilities',
  {
    description: 'Read the Breadstick capability manifest (breadstick-manifest.json). Without a section: section names, item counts, and generator warnings. With a section: that section in full. Sections: serverRoutes, remotionCompositions, canvasNodes, recipes, brollCatalog, carouselTemplates, characters, cliVerbs, topics, skills.',
    inputSchema: {
      section: z.string().optional().describe('Manifest section name to return in full'),
    },
  },
  async ({ section }) => {
    let manifest;
    try {
      manifest = await loadManifest();
    } catch (err) {
      return fail(err.message);
    }
    if (!section) {
      // Sections come in a few shapes: plain arrays, { count, items }
      // (brollCatalog), { _comment, list } (characters), and grouped arrays
      // ({ 'skills': [...], '.claude/skills': [...] }). Count items, not keys.
      const countOf = (value) => {
        if (Array.isArray(value)) return value.length;
        if (typeof value?.count === 'number') return value.count;
        if (Array.isArray(value?.list)) return value.list.length;
        const arrays = Object.values(value || {}).filter(Array.isArray);
        if (arrays.length > 0) return arrays.reduce((sum, a) => sum + a.length, 0);
        return Object.keys(value || {}).length;
      };
      const counts = Object.fromEntries(
        Object.entries(manifest.sections).map(([name, value]) => [name, countOf(value)])
      );
      return ok({ generated: manifest.generated, warnings: manifest.warnings, sections: counts });
    }
    if (!(section in manifest.sections)) {
      return fail(`Unknown section "${section}". Available: ${Object.keys(manifest.sections).join(', ')}`);
    }
    return ok(manifest.sections[section]);
  }
);

server.registerTool(
  'list_characters',
  {
    description: 'List the default Breadstick AI-influencer characters (id, name, handle, niche, tagline, hasCameo). User-added characters live in browser localStorage and are not visible here.',
    inputSchema: {},
  },
  async () => {
    let characters;
    try {
      characters = await loadCharacters();
    } catch (err) {
      return fail(`Failed to load characters: ${err.message}`);
    }
    return ok({
      characters: characters.map((c) => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        niche: c.niche,
        tagline: c.tagline,
        hasCameo: !!c.cameoName,
      })),
      note: 'Characters added via the "+ Add Character" form live in browser localStorage and are not listed here.',
    });
  }
);

server.registerTool(
  'generate_script',
  {
    description: 'Generate a production-ready influencer script: assembles the real classic-view system/user prompts (scriptPrompts.js) for a character + ingredient selection and POSTs them through the local /api/generate Anthropic proxy. Requires the Breadstick server (npm run server). Use list_characters for ids; pain points and hooks are 0-based indices into the character arrays; scriptTypeId: affirmation-vision | problem-solution | quiet-truth | pattern-interrupt | story-based; conversionLevelId: no-cta | soft-bridge | testimonial-bridge | direct-ask.',
    inputSchema: {
      characterId: z.string().describe('Character id, e.g. "mia-chen"'),
      painPointIndex: z.number().int().min(0).describe('0-based index into the character painPoints array'),
      hookIndex: z.number().int().min(0).describe('0-based index into the character hooks array'),
      scriptTypeId: z.string().describe('Script type id, e.g. "problem-solution"'),
      conversionLevelId: z.string().describe('Conversion level id, e.g. "soft-bridge"'),
      model: z.string().optional().describe('Anthropic model id; omit to use the /api/generate default'),
    },
  },
  async ({ characterId, painPointIndex, hookIndex, scriptTypeId, conversionLevelId, model }) => {
    let character, buildSystemPrompt, buildUserPrompt, scriptTypes, conversionLevels;
    try {
      const [chars, prompts, types] = await Promise.all([
        loadCharacters(),
        import('../src/data/scriptPrompts.js'),
        import('../src/data/scriptTypes.js'),
      ]);
      character = chars.find((c) => c.id === characterId);
      ({ buildSystemPrompt, buildUserPrompt } = prompts);
      ({ scriptTypes, conversionLevels } = types);
      if (!character) {
        return fail(`Unknown characterId "${characterId}". Available: ${chars.map((c) => c.id).join(', ')}`);
      }
    } catch (err) {
      return fail(`Failed to load script data modules: ${err.message}`);
    }

    // Validate every selection up front — buildSystemPrompt assumes valid
    // ids/indices and would throw an opaque TypeError otherwise.
    if (painPointIndex >= character.painPoints.length) {
      return fail(`painPointIndex ${painPointIndex} out of range — ${character.name} has ${character.painPoints.length} pain points (0-${character.painPoints.length - 1}).`);
    }
    if (hookIndex >= character.hooks.length) {
      return fail(`hookIndex ${hookIndex} out of range — ${character.name} has ${character.hooks.length} hooks (0-${character.hooks.length - 1}).`);
    }
    if (!scriptTypes.some((t) => t.id === scriptTypeId)) {
      return fail(`Unknown scriptTypeId "${scriptTypeId}". Available: ${scriptTypes.map((t) => t.id).join(', ')}`);
    }
    if (!conversionLevels.some((c) => c.id === conversionLevelId)) {
      return fail(`Unknown conversionLevelId "${conversionLevelId}". Available: ${conversionLevels.map((c) => c.id).join(', ')}`);
    }

    // Selections use the same shape App.jsx passes to the prompt builders:
    // indices for painPoint/hook, ids for scriptType/conversionLevel.
    const selections = {
      painPoint: painPointIndex,
      hook: hookIndex,
      scriptType: scriptTypeId,
      conversionLevel: conversionLevelId,
    };
    const system = buildSystemPrompt(character, selections);
    const userPrompt = buildUserPrompt(character, selections);

    let response, data;
    try {
      response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          system,
          messages: [{ role: 'user', content: userPrompt }],
          lane: 'mcp',
        }),
      });
      data = await response.json();
    } catch (err) {
      if (isConnRefused(err)) return fail(SERVER_DOWN);
      return fail(`/api/generate request failed: ${err.message}`);
    }
    if (!response.ok) {
      return fail(`/api/generate returned ${response.status}: ${JSON.stringify(data?.error || data)}`);
    }

    // /api/generate proxies the Anthropic Messages response verbatim — the
    // script lives in the text content blocks.
    const script = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    return ok({
      character: character.name,
      scriptType: scriptTypeId,
      conversionLevel: conversionLevelId,
      model: data.model,
      script,
    });
  }
);

server.registerTool(
  'query_ledger',
  {
    description: 'Read Breadstick activity-ledger events (data/ledger/*.jsonl) for a [from, to) ISO-8601 window. Reads straight from disk — works even when the Breadstick server is down.',
    inputSchema: {
      from: z.string().describe('Window start, ISO-8601 (inclusive), e.g. "2026-06-01T00:00:00.000Z"'),
      to: z.string().describe('Window end, ISO-8601 (exclusive)'),
    },
  },
  async ({ from, to }) => {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return fail('from/to must be valid ISO-8601 timestamps, e.g. "2026-06-01T00:00:00.000Z"');
    }
    if (fromMs >= toMs) {
      return fail('"from" must be earlier than "to"');
    }
    // readWindow compares ISO strings lexicographically, so normalize both
    // bounds to full UTC ISO before passing them down.
    const { readWindow } = await import('../server/activityLedger.js');
    const events = readWindow(new Date(fromMs).toISOString(), new Date(toMs).toISOString());
    return ok({ count: events.length, events });
  }
);

server.registerTool(
  'query_perf',
  {
    description: 'Read Breadstick performance-ledger snapshots (data/perf/*.jsonl) for a [from, to) ISO-8601 window. Each snapshot: { ts, postId, lane, angle, source, state, metrics }. Joins with query_ledger type:"post" events on postId. Reads straight from disk — works even when the Breadstick server is down.',
    inputSchema: {
      from: z.string().describe('Window start, ISO-8601 (inclusive)'),
      to: z.string().describe('Window end, ISO-8601 (exclusive)'),
    },
  },
  async ({ from, to }) => {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      return fail('from/to must be valid ISO-8601 timestamps');
    }
    if (fromMs >= toMs) {
      return fail('"from" must be earlier than "to"');
    }
    const { readPerfWindow } = await import('../server/perfLedger.js');
    const events = readPerfWindow(new Date(fromMs).toISOString(), new Date(toMs).toISOString());
    return ok({ count: events.length, events });
  }
);

server.registerTool(
  'call_endpoint',
  {
    description: 'Call any Breadstick server route on localhost:3001. Gated by breadstick-manifest.json: the method+path must match a known serverRoutes entry (express :params match segment-wise), only GET/POST are forwarded, and streaming (SSE) routes are rejected. Requires the Breadstick server (npm run server). Use breadstick_capabilities({ section: "serverRoutes" }) to browse the surface.',
    inputSchema: {
      method: z.enum(['GET', 'POST']).describe('HTTP method'),
      path: z.string().describe('Route path including any query string, e.g. "/api/kie/status/abc123"'),
      body: z.record(z.string(), z.unknown()).optional().describe('JSON body for POST requests'),
    },
  },
  async ({ method, path, body }) => {
    let manifest;
    try {
      manifest = await loadManifest();
    } catch (err) {
      return fail(err.message);
    }

    const gate = gateRequest(manifest.sections?.serverRoutes, method, path);
    if (!gate.ok) return fail(gate.error);

    let response, text;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        method,
        ...(method === 'POST'
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }
          : {}),
      });
      text = await response.text();
    } catch (err) {
      if (isConnRefused(err)) return fail(SERVER_DOWN);
      return fail(`Request failed: ${err.message}`);
    }

    // Hand back JSON when the route speaks JSON, raw text otherwise.
    let parsed = text;
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
    }
    return ok({ status: response.status, body: parsed });
  }
);

server.registerTool(
  'run_job',
  {
    description: 'Enqueue a Breadstick footage job on the server job queue (single worker, concurrency 1; runs asynchronously). Returns a ticket { id, status } immediately — poll it with job_status. Requires the Breadstick server (npm run server). Known types: "shortform-process" (input: { pack?: "none" | "<overlay-pack>" }) and "longform" (input: { fileId: "<drive-id>", silenceCut?: boolean }). The server validates the type — new server-side lanes are accepted automatically.',
    inputSchema: {
      type: z.string().describe('Job type, e.g. "shortform-process" or "longform"'),
      input: z.record(z.string(), z.unknown()).optional().describe('Per-type payload — see description for keys'),
      notify: z.record(z.string(), z.unknown()).optional().describe('Optional completion ping, e.g. { surface: "whatsapp", to: "<e164>" }'),
    },
  },
  async (args) => {
    const r = await runJob(args, { fetchImpl: fetch, apiBase: API_BASE });
    return r.ok ? ok(r.data) : fail(r.error);
  }
);

server.registerTool(
  'job_status',
  {
    description: 'Read Breadstick job-queue state. With "id": that one job (full record incl. status, result, error). Without "id": all jobs, optionally filtered by "status" (queued | running | done | error | cancelled). Requires the Breadstick server (npm run server).',
    inputSchema: {
      id: z.string().optional().describe('Job id to fetch; omit to list all jobs'),
      status: z.string().optional().describe('Filter the list by status (ignored when id is given)'),
    },
  },
  async (args) => {
    const r = await jobStatus(args, { fetchImpl: fetch, apiBase: API_BASE });
    return r.ok ? ok(r.data) : fail(r.error);
  }
);

/* ===== start ===== */

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[breadstick-mcp] stdio server ready');
}

main().catch((err) => {
  console.error('[breadstick-mcp] fatal:', err);
  process.exit(1);
});
