# llm-monitor

A terminal dashboard for a local LLM stack on macOS. It watches LiteLLM, llama-swap, oMLX and `mlx_lm.server` (Ollama if you ask for it), shows which models are loaded and how fast they're generating, and flags any server that has gone down. It also prints one-shot reports, including clean JSON for scripts and agents.

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

Every provider is polled concurrently. One that's down shows as `OFFLINE` and the rest of the screen keeps working.

## Install

```bash
git clone https://github.com/slogsdon/llm-monitor.git
cd llm-monitor
npm install        # also builds dist/
npm link           # puts `llm-monitor` on PATH
```

You need Node 23.6 or newer. The tests run TypeScript directly through Node's native type stripping.

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

These flags work on every subcommand:

| Flag | Effect |
|---|---|
| `-p, --provider <ids>` | Scope to `litellm`, `llamaswap`, `mlx`, `ollama` (comma-separated) |
| `-m, --model <name>` | Filter models and routes whose id or alias contains `<name>` (idle matches are shown too) |
| `-c, --config <path>` | LiteLLM config path. Defaults, in order: `$LITELLM_CONFIG`, `~/.config/litellm/config.yaml`, `./litellm_config.yaml` |
| `--json` | Clean JSON on stdout, no colour or UI |
| `-q, --quiet` | Drop headers and the system panel |
| `--ascii` | ASCII borders and glyphs. This turns on by itself when the locale isn't UTF-8, and `NO_COLOR` disables colour |

Dashboard keys: `q` quit, `p` pause, `+`/`-` double or halve the interval, `i` show idle models, `?` help.

`report` and `providers` exit `0` when everything is healthy, `1` when any provider is degraded and `2` when nothing is reachable. Without `--provider`, a provider that isn't running is left out and only "nothing reachable" returns `2`. With `--provider`, any requested provider being down returns `2`.

## Layout

The screen is organised by what needs your attention, not by provider. System meters sit on top. Below them is one Models table across every backend, sorted generating first, then resident, then loading, with idle models collapsed to a count. The Routing panel lists only the LiteLLM aliases that completed a request in the last 60 seconds, and a single status line at the bottom shows each provider.

Colour only ever means something (green, yellow and red thresholds, dim for idle). The status dots carry the same information, so nothing is lost without colour.

Terminal size comes from `$COLUMNS` and `$LINES` first, then the TTY. At 110 columns or wider, System and Routing sit side by side, and below that they stack. When a table won't fit, the optional columns (PROMPT, MEM, CTX and the alias MODEL column) drop first, then the name column shrinks. Short terminals cap the rows with `+N more`. If a poll fails, the last good frame stays up with `stale Ns` in the header.

## What each provider exposes

| Provider | Ports | Endpoints | Metrics |
|---|---|---|---|
| LiteLLM | 4000 | `/health/liveliness`, `/health/readiness`, `/model/info`, `/spend/logs/ui` (the last two need the master key) | Alias routes, plus per-alias requests, tokens, mean latency and errors over the last 60 s. Spend logs flush in roughly 10 s batches, so activity lags a little |
| llama-swap | 8080-8082 | `/v1/models`, `/running`, `/upstream/<model>/{metrics,props}` | Load state per model. With llama.cpp started under `--metrics`, also tok/s, KV usage and queue |
| oMLX | 8000, 8080-8090 | `/api/status`, `/v1/models/status`, `/admin/api/activity` | Per-request gen and prompt tok/s, context in use, memory, active and waiting queue |
| `mlx_lm.server` | 8080-8090 | `/v1/models` | Loaded model only |
| Ollama | 11434 | `/api/version`, `/api/ps`, `/api/tags` | Resident models, memory and context length. Opt-in with `--provider ollama`, since I run it as a benchmarking sidecar rather than part of the serving stack |

The LiteLLM master key comes from `$LITELLM_MASTER_KEY`. Failing that, llm-monitor reads the `os.environ/…` name from the config's `general_settings.master_key` and looks it up in a `.env` beside the config or one directory above it. Without a key, routes come from the config file instead.

Aliases are matched to backend models by port and model name, and they show up as `aliases` in `--json`. That's why `--model fast` also matches the backend model `fast` routes to.

Set `LLM_MONITOR_HOST` to probe somewhere other than `127.0.0.1`.

## System metrics (macOS)

GPU utilisation comes from `ioreg -c IOAccelerator` ("Device Utilization %"), which doesn't need root.

GPU power in watts needs `powermetrics`, and that is root-only. To show it, allow it without a password:

```bash
echo "$USER ALL=(root) NOPASSWD: /usr/bin/powermetrics" | sudo tee /etc/sudoers.d/powermetrics
sudo chmod 440 /etc/sudoers.d/powermetrics
```

llm-monitor tries `sudo -n powermetrics` once per process. Without the rule it quietly shows utilisation only.

MEM matches Activity Monitor's "Memory Used" (wired + app + compressed, from `vm_stat`), plus the kernel's memory-pressure level (`kern.memorystatus_level`, inverted). MDL is resident model memory against oMLX's model-memory ceiling.

## Resource use

The dashboard is meant to be left running, so I tuned the polling path not to grow. On an M4, the default 3s dashboard settles at about 140 MB RSS and 0.4% CPU after a 30-minute soak, with no upward trend left (+0.01 MB/min). An earlier version climbed past 256 MB and kept going. A 1s refresh costs about 12 MB more.

Here's what holds it there.

- The `bin` shebang runs node with `--max-semi-space-size=4`. Node's 16 MB default let V8 commit around 84 MB of heap for a 20 MB live set. Capping it keeps the heap near 40 MB and saves about 50 MB of RSS. This only applies when you run the `llm-monitor` shim directly. If you launch with `node dist/cli.js`, the shebang is ignored, so pass the flag yourself or set `NODE_OPTIONS=--max-semi-space-size=4`.
- Port discovery is cached for 30 s. Probing every candidate port costs 16 requests (mlx alone has 12 candidates), and over half of them get connection-refused. With the cache, a steady-state tick drops from 32 requests to about 5. A failed poll clears the cache, so a server that restarts on another port is found on the next tick.
- System metrics are cached too: `vm_stat`, `sysctl` and `ioreg` for 3 s, `powermetrics` for 30 s. `ioreg -c IOAccelerator` alone prints about 47 KB per call, and the four spawns together cost around 17 ms.
- The LiteLLM alias table is reused for 30 s and `/spend/logs/ui` for 10 s, which matches how often LiteLLM flushes its spend batches.
- React runs in production mode and loads only when needed. `NODE_ENV` defaults to `production` (an explicit value is respected), and only `monitor` and `history` import the dashboard module. `report`, `providers` and `--json` never load Ink, which saves about 20 MB on a one-shot run.

Of the 140 MB steady state, roughly 92 MB is the Node/V8 floor (the same loop without Ink plateaus there) and about 46 MB is Ink and React.

The 60 s history window is time-based, so a longer `--interval` gives you fewer sparkline samples. Series for models that stop reporting are dropped once they age out.

## Known gaps

- Ollama doesn't expose tok/s outside a generation response, so that column shows `—`.
- LiteLLM activity is counted per completed request. An in-flight request shows up in the backend's ACT/Q column first and in Routing once it finishes. I left out per-alias gen tok/s on purpose, because LiteLLM's `completionStartTime` equals `endTime` for non-streamed calls and the number would be meaningless.
- The llama-swap `/upstream/*/metrics` and `/props` parsing follows llama.cpp's documented gauge names. I couldn't exercise it at build time because no model was running.
- `history` keeps its 60-second window in process memory only.

## Development

```bash
npm run build      # tsc → dist/
npm test           # node:test, no framework
npm run typecheck
```

## License

MIT
