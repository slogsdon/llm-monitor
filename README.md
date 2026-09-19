# llm-monitor

Live dashboard and snapshot reports for the local LLM stack: LiteLLM, llama-swap, oMLX / `mlx_lm.server` (Ollama on request). Polls every provider concurrently, degrades to `OFFLINE` instead of crashing, and emits clean JSON for agents.

```
llm-monitor · mac-mini                                              18:21:59 · 1s · ● HEALTHY
╭─ System ────────────────────────────────╮╭─ Routing · LiteLLM v1.82.6 · last 60s ─────────╮
│ CPU  ▰▰▰▱▱▱▱▱▱▱  32%  Apple M4          ││ ALIAS   MODEL                    REQ  TOK  LAT │
│ GPU  ▰▰▰▰▰▰▰▰▰▰  100%  10 cores         ││ fast    gemma-4-E4B-it-qat-4bit    9  20k 2.8s │
│ MEM  ▰▰▰▰▰▰▰▰▱▱  78%  25.0/32.0GB  …    ││ 36 aliases idle                                │
│ MDL  ▰▰▰▱▱▱▱▱▱▱  25%  6.7/26.5GB        ││                                                │
╰─────────────────────────────────────────╯╰────────────────────────────────────────────────╯
╭─ Models ────────────────────────────────────────────────────────────────────────────────╮
│ MODEL                    BACKEND  STATE  GEN t/s  PROMPT   MEM      CTX  ACT/Q  60s     │
│ gemma-4-E4B-it-qat-4bit  oMLX     ready     14.7       —  6.7GB  28/131k    1/0  ▁███▇  │
│ 9 idle on oMLX · 17 idle on llama-swap                                                  │
╰─────────────────────────────────────────────────────────────────────────────────────────╯
● LiteLLM:4000   ● llama-swap:8081   ● oMLX:8000
q quit   p pause   +/- interval   i idle models   ? help
```

## Install

```bash
cd ~/Code/llm-monitor
npm install        # also builds dist/
npm link           # puts `llm-monitor` on PATH
```

Requires Node ≥ 23.6 (tests run TypeScript directly via native type stripping).

## Usage

```bash
llm-monitor                     # live dashboard, 3s refresh, q to quit
llm-monitor -i 1 -w gemma-4     # 1s refresh, only models matching "gemma-4"
llm-monitor report              # point-in-time table
llm-monitor report --json       # machine-readable snapshot
llm-monitor report --markdown   # for docs
llm-monitor providers           # one line per provider
llm-monitor history             # 60s tok/s sparklines per loaded model
llm-monitor --json              # NDJSON: one snapshot per tick
eval "$(llm-monitor completion zsh)"   # or bash
```

Common flags (every subcommand):

| Flag | Effect |
|---|---|
| `-p, --provider <ids>` | Scope to `litellm`, `llamaswap`, `mlx`, `ollama` (comma-separated) |
| `-m, --model <name>` | Filter models/routes whose id or alias contains `<name>` (idle matches are shown too) |
| `-c, --config <path>` | LiteLLM config path (default: `$LITELLM_CONFIG`, `~/Code/otel-local-ai/litellm/config.yaml`, `~/.config/litellm/config.yaml`, `./litellm_config.yaml`) |
| `--json` | Clean JSON on stdout, no color or UI |
| `-q, --quiet` | Drop headers and the system panel |
| `--ascii` | ASCII borders/glyphs (automatic when the locale is not UTF-8; `NO_COLOR` disables colour) |

Dashboard keys: `q` quit · `p` pause · `+`/`-` double/halve the interval · `i` show idle models · `?` help.

## Resource use

The dashboard is meant to be left running, so the polling path is tuned not to grow. Measured on an M4, the default 3s dashboard settles at **~140 MB** RSS and **~0.4 % CPU** after a 30-minute soak, with no further upward trend (+0.01 MB/min); the same stack previously climbed past 256 MB and kept going. A 1s refresh costs about 12 MB more. What keeps it there:

- **Bounded V8 young generation.** The `bin` shebang runs node with `--max-semi-space-size=4`. Node's 16 MB default let V8 commit ~84 MB of heap for a ~20 MB live set; capping it holds the heap near 40 MB and saves ~50 MB of RSS. This applies when the `llm-monitor` shim is executed directly — if you launch via `node dist/cli.js` the shebang is ignored, so pass the flag yourself or set `NODE_OPTIONS=--max-semi-space-size=4`.
- **Cached port discovery.** Probing every candidate port costs 16 requests (mlx alone offers 12), over half of them connection-refused. Discovery results are reused for 30 s, which takes a steady-state tick from 32 requests to about 5. A failed poll drops the cache so a server that restarts on another port is found on the next tick.
- **Cached system metrics.** `vm_stat`, `sysctl` and `ioreg` are reused for 3 s and `powermetrics` for 30 s. `ioreg -c IOAccelerator` alone emits ~47 KB per call, and the four spawns together cost ~17 ms.
- **Cached LiteLLM metadata.** The alias table is reused for 30 s and `/spend/logs/ui` for 10 s, matching the rate LiteLLM flushes its spend batches.
- **Production React, loaded on demand.** `NODE_ENV` defaults to `production` (an explicit value is respected) and the dashboard module is imported only by `monitor`/`history` — so `report`, `providers` and `--json` do not load Ink at all (~20 MB less for a one-shot run).

Of the ~140 MB steady state, roughly 92 MB is the Node/V8 floor (the same loop without Ink plateaus there) and ~46 MB is Ink/React. The 60 s history window is time-based, so a longer `--interval` yields proportionally fewer sparkline samples; series for models that stop being reported are dropped once they age out.

Exit codes for `report` and `providers`: `0` healthy, `1` any provider degraded, `2` unreachable. Without `--provider`, an undetected provider is simply absent; only "nothing reachable" is `2`. With `--provider`, a requested provider being down is `2`.

## Layout

Organised by attention, not by provider: system meters on top, one **Models** table across every backend (generating first, then resident, then loading; idle collapsed to a count), a **Routing** panel listing only LiteLLM aliases that completed requests in the last 60 s, and a one-line provider status strip. Colour is semantic only (green/yellow/red thresholds, dim for idle); status dots carry the same information without colour.

Honours `$COLUMNS` / `$LINES` before the TTY size. At ≥110 columns System and Routing sit side by side; below that they stack. When a table will not fit, non-essential columns (PROMPT, MEM, CTX, MODEL-of-alias) drop first, then the name column shrinks. Short terminals cap table rows with `+N more`. A failed poll keeps the last good frame and shows `stale Ns` in the header.

## What each provider exposes

| Provider | Ports | Endpoints | Metrics |
|---|---|---|---|
| LiteLLM | 4000 | `/health/liveliness`, `/health/readiness`, `/model/info`, `/spend/logs/ui` (last two need the master key) | alias routes; per-alias requests, tokens, mean latency and errors over the last 60 s (spend logs are flushed in ~10 s batches, so activity lags slightly) |
| llama-swap | 8080–8082 | `/v1/models`, `/running`, `/upstream/<model>/{metrics,props}` | load state per model; llama.cpp tok/s, KV usage, queue when started with `--metrics` |
| oMLX | 8000, 8080–8090 | `/api/status`, `/v1/models/status`, `/admin/api/activity` | per-request gen/prompt tok/s, context in use, memory, active/waiting queue |
| `mlx_lm.server` | 8080–8090 | `/v1/models` | loaded model only |
| Ollama | 11434 | `/api/version`, `/api/ps`, `/api/tags` | resident models, memory, context length — **opt-in** via `--provider ollama` (benchmarking sidecar, not part of the serving stack) |

LiteLLM master key: `$LITELLM_MASTER_KEY`, else the `os.environ/…` name from the config's `general_settings.master_key`, resolved from a `.env` beside or one directory above the config. Without a key, routes fall back to the config file. Aliases are cross-referenced onto backend models by port + model name (exposed as `aliases` in `--json`) so `--model fast` also matches the backend model it routes to.

`LLM_MONITOR_HOST` overrides the probe host (default `127.0.0.1`).

## System metrics (macOS)

- **GPU utilisation** comes from `ioreg -c IOAccelerator` ("Device Utilization %") — no root needed.
- **GPU power (W)** needs `powermetrics`, which is root-only. To show it, allow it without a password:

  ```bash
  echo "$USER ALL=(root) NOPASSWD: /usr/bin/powermetrics" | sudo tee /etc/sudoers.d/powermetrics
  sudo chmod 440 /etc/sudoers.d/powermetrics
  ```

  llm-monitor probes `sudo -n powermetrics` once per process; without the rule it silently shows utilisation only.
- **MEM** is Activity Monitor's "Memory Used" (wired + app + compressed, from `vm_stat`) plus the kernel's memory-pressure level (`kern.memorystatus_level`, inverted). `MDL` is resident model memory against oMLX's model-memory ceiling.

## Known gaps

- Ollama does not expose tok/s outside a generation response; shows `—`.
- LiteLLM activity is per completed request, so an in-flight request appears on the backend's ACT/Q column first and in Routing once it finishes. Per-alias gen tok/s is deliberately not shown: LiteLLM's `completionStartTime` equals `endTime` for non-streamed calls, which would make the number meaningless.
- llama-swap `/upstream/*/metrics` and `/props` parsing is written against llama.cpp's documented gauge names and could not be exercised at build time (no model was running).
- `history` keeps its 60-second window in process memory only.

## Development

```bash
npm run build      # tsc → dist/
npm test           # node:test, no framework
```
