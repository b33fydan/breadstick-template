# ensure-server.ps1 — idempotent launcher for the Breadstick Express proxy.
#
# Why this exists: the proactive Maestro scheduler (grandpa-riddle-daily 6pm,
# morning/evening threads) is a node-cron timer that lives INSIDE server.js and
# has no missed-fire catch-up. It only fires while this process is alive. This
# launcher is run by the "BreadstickServer" Scheduled Task (At Log On) so the
# server — and therefore the 6pm fire — is up without anyone remembering to run
# `npm run server`.
#
# Safe to run by hand or on a repeating trigger: it starts server.js ONLY if
# nothing is already listening on :3001, so it never double-binds the port.
# Server stdout/stderr are captured to server.out.log / server.err.log at the
# repo root (previously the [proactive] fire logs went to a terminal and were
# lost).

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$port = 3001

# Already up? Nothing to do.
$listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listening) { exit 0 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'node not found on PATH'; exit 1 }

Start-Process -FilePath $node -ArgumentList 'server.js' `
  -WorkingDirectory $repo -WindowStyle Hidden `
  -RedirectStandardOutput "$repo\server.out.log" `
  -RedirectStandardError  "$repo\server.err.log"
exit 0
