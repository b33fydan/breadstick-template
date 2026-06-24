// server/execEnv.js — child-process env builder for the /api/exec Command Runner.
// The server process legitimately holds every API key (.env backfill at startup),
// but user-typed shell commands must NOT inherit them by default — a stray
// `set`/`env` or a curl in a pasted snippet would exfiltrate the whole keyring.
// Pure function, no I/O. ESM (package is "type": "module").

// Name-based heuristic: anything that *looks* like a credential is withheld.
// Catches ANTHROPIC_API_KEY, WHATSAPP_ACCESS_TOKEN, GOOGLE_DRIVE_SA_KEY,
// SLACK_SIGNING_SECRET, DB_PASSWORD, WS_TOKEN-style names. Everything else
// (PATH, SystemRoot, APPDATA, TEMP, USERPROFILE, npm_config_*) passes through —
// Windows child processes break without the system vars.
export const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE)/i;

export function buildExecEnv(processEnv, requestEnv = {}, opts = {}) {
  const inheritSecrets = opts.inheritSecrets === true;
  const request = requestEnv || {};
  const env = {};
  const stripped = [];

  for (const [name, value] of Object.entries(processEnv || {})) {
    if (!inheritSecrets && SECRET_KEY_PATTERN.test(name)) {
      stripped.push(name);
      continue;
    }
    env[name] = value;
  }

  // Request-supplied vars apply LAST and are never stripped — an explicit
  // per-request env var is deliberate operator intent (the endpoint is
  // already localhostOnly). This is also the surgical way to hand ONE key
  // to a command without opting into the full keyring via inheritSecrets.
  for (const [name, value] of Object.entries(request)) {
    env[name] = value;
  }

  // strippedKeys reports what was withheld (names only, never values) so the
  // route can tell the canvas node why a command might be missing a key.
  // Keys reintroduced via requestEnv are present in the final env, so they
  // don't count as withheld.
  const strippedKeys = stripped
    .filter((name) => !Object.prototype.hasOwnProperty.call(request, name))
    .sort();

  return { env, strippedKeys };
}
