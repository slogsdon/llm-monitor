# llm-monitor

Live dashboard and snapshot reports for the local LLM stack: LiteLLM, llama-swap, oMLX / `mlx_lm.server`, Ollama. Polls every provider concurrently, degrades to `OFFLINE` instead of crashing, and emits clean JSON for agents.

## Install

```bash
cd ~/Code/llm-monitor
npm install        # also builds dist/
npm link           # puts `llm-monitor` on PATH
```

Requires Node ≥ 23.6 (tests run TypeScript directly via native type stripping).

## Usage

```bash
llm-monitor                     # live dashboard, 1s refresh, q to quit
llm-monitor -i 2 -w gemma-4     # 2s refresh, only models matching "gemma-4"
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

Exit codes for `report` and `providers`: `0` healthy, `1` any provider degraded, `2` unreachable. Without `--provider`, an undetected provider is simply absent; only "nothing reachable" is `2`. With `--provider`, a requested provider being down is `2`.

Layout honours `$COLUMNS` / `$LINES` before the TTY size. Under 112 columns the table drops the prompt-tps, memory, and context columns and shrinks the model column to fit.

## What each provider exposes

| Provider | Ports | Endpoints | Metrics |
|---|---|---|---|
| LiteLLM | 4000 | `/health/liveliness`, `/health/readiness`, `/model/info` (needs master key) | alias → backend routes; version; readiness/db state |
| llama-swap | 8080–8082 | `/v1/models`, `/running`, `/upstream/<model>/{metrics,props}` | load state per model; llama.cpp tok/s, KV usage, queue when started with `--metrics` |
| oMLX | 8000, 8080–8090 | `/api/status`, `/v1/models/status`, `/admin/api/activity` | per-request gen/prompt tok/s, context in use, memory, active/waiting queue |
| `mlx_lm.server` | 8080–8090 | `/v1/models` | loaded model only |
| Ollama | 11434 | `/api/version`, `/api/ps`, `/api/tags` | resident models, memory, context length |

LiteLLM master key: `$LITELLM_MASTER_KEY`, else the `os.environ/…` name from the config's `general_settings.master_key`, resolved from a `.env` beside or one directory above the config. Without a key, routes fall back to the config file. Aliases are cross-referenced onto backend models by port + model name, so the oMLX row shows `gemma-4-E4B-it-qat-4bit (fast,balanced,+14)`.

`LLM_MONITOR_HOST` overrides the probe host (default `127.0.0.1`).

## Known gaps

- Ollama does not expose tok/s outside a generation response; shows `—`.
- GPU utilisation needs `powermetrics` (root) on macOS; shows `—`. Memory is reported as the kernel pressure level because `os.freemem()` is meaningless once the page cache is warm.
- llama-swap `/upstream/*/metrics` and `/props` parsing is written against llama.cpp's documented gauge names and could not be exercised at build time (no model was running).
- `history` keeps its 60-second window in process memory only.

## Development

```bash
npm run build      # tsc → dist/
npm test           # node:test, no framework
```
