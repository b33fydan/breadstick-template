# Security

Breadstick is a **local-first, single-operator tool**. The Express proxy on port
3001 exists so your own browser can reach AI providers and your own disk — it is
not designed to be exposed to a network of any kind.

## The posture, in three lines

- The API server binds **127.0.0.1 only** by default. Nothing on your LAN can
  reach it unless you opt in with `BREADSTICK_HOST=0.0.0.0`.
- Routes that read caller-supplied paths from your disk (file pickers, media
  probes, upload helpers) additionally require a **loopback peer and a loopback
  browser Origin** (`localBrowserOnly`), and reject anything arriving through a
  tunnel or reverse proxy (`notViaTunnel`).
- A regression test (`server/fsRouteGuards.test.js`) scans the server source and
  fails the suite if any caller-path route is ever added without those guards.

## What you must not do

**Do not expose port 3001 to the internet** — not with a Cloudflare tunnel, not
with ngrok, not with port forwarding. The proxy holds your API keys (from `.env`
or your browser's localStorage) and its filesystem routes are designed around
the assumption that the only caller is you, on this machine. Exposing it hands
both to whoever finds it.

If you need a public preview of rendered output, serve the *rendered files*
from a separate static host — never the proxy itself.

## Keys

Bring-your-own-key: keys live in your local `.env` (never committed — see
`.gitignore`) or in your browser's localStorage. They are sent only to the
provider they belong to (Anthropic, kie.ai, Blotato, ElevenLabs). Rotate any
key you believe has leaked; nothing in this repo stores them elsewhere.

## Reporting

Found something? Open a GitHub issue with the label `security` — or, if it is
sensitive, use GitHub's private vulnerability reporting on this repository.
