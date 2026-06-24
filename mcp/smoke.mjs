// mcp/smoke.mjs — standalone smoke test for the Breadstick MCP server.
//
// Spawns `node mcp/server.js`, drives a raw JSON-RPC handshake over stdio
// (initialize → notifications/initialized → tools/list), and asserts all
// five Breadstick tools are advertised. No dependencies — MCP stdio framing
// is newline-delimited JSON-RPC messages, which a line buffer handles.
//
//   node mcp/smoke.mjs    → PASS (exit 0) / FAIL (exit 1)


import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, 'server.js');

const EXPECTED_TOOLS = [
  'breadstick_capabilities',
  'list_characters',
  'generate_script',
  'query_ledger',
  'query_perf',
  'call_endpoint',
];

const child = spawn(process.execPath, [SERVER_PATH], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let settled = false;
function finish(passed, detail) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  child.kill();
  if (passed) {
    console.log(`PASS — ${detail}`);
    process.exit(0);
  }
  console.error(`FAIL — ${detail}`);
  process.exit(1);
}

// Hard ceiling so a hung handshake never wedges CI or a shell.
const timer = setTimeout(() => finish(false, 'timed out after 15s waiting for tools/list response'), 15000);

child.on('error', (err) => finish(false, `failed to spawn server: ${err.message}`));
child.on('exit', (code) => {
  if (!settled) finish(false, `server exited early with code ${code}`);
});
// Server diagnostics ride stderr; surface them for debuggability.
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

// Line-buffered JSON-RPC reader: stdout chunks split on newlines, each
// complete line is one message.
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      finish(false, `non-JSON line on stdout: ${line.slice(0, 200)}`);
      return;
    }
    handleMessage(msg);
  }
});

function handleMessage(msg) {
  if (msg.id === 1) {
    // initialize response → ack with the initialized notification, then list tools
    if (msg.error) return finish(false, `initialize error: ${JSON.stringify(msg.error)}`);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    return;
  }
  if (msg.id === 2) {
    if (msg.error) return finish(false, `tools/list error: ${JSON.stringify(msg.error)}`);
    const names = (msg.result?.tools || []).map((t) => t.name);
    const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
    if (missing.length > 0) {
      return finish(false, `missing tools: ${missing.join(', ')} (got: ${names.join(', ')})`);
    }
    return finish(true, `all ${EXPECTED_TOOLS.length} tools advertised: ${names.join(', ')}`);
  }
}

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'breadstick-smoke', version: '1.0.0' },
  },
});
