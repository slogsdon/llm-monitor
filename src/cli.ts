#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { Command, InvalidArgumentError } from 'commander';
import { collect, type CollectOptions } from './collect.ts';
import { completionScript } from './completion.ts';
import { runDashboard } from './dashboard.tsx';
import { exitCode } from './health.ts';
import { History } from './history.ts';
import { PROVIDER_IDS } from './providers/index.ts';
import { providersText, toJson, toMarkdown, toText } from './report.ts';
import type { ProviderId } from './types.ts';

interface CommonOptions {
  provider?: ProviderId[];
  model?: string;
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function parseProviders(value: string): ProviderId[] {
  const ids = value.split(',').map((id) => id.trim().toLowerCase());
  const unknown = ids.filter((id) => !PROVIDER_IDS.includes(id as ProviderId));
  if (unknown.length) throw new InvalidArgumentError(`unknown provider(s) ${unknown.join(', ')}; expected ${PROVIDER_IDS.join('|')}`);
  return ids as ProviderId[];
}

function parseInterval(value: string): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0.25) throw new InvalidArgumentError('interval must be a number ≥ 0.25');
  return Math.round(seconds * 1000);
}

function withCommonOptions(command: Command): Command {
  return command
    .option('-p, --provider <ids>', `scope to provider(s), comma-separated: ${PROVIDER_IDS.join('|')}`, parseProviders)
    .option('-m, --model <name>', 'filter to models whose id or alias contains <name>')
    .option('-c, --config <path>', 'LiteLLM config path (default: auto-detect)')
    .option('--json', 'emit JSON to stdout (no color, no UI)')
    .option('-q, --quiet', 'suppress headers and system panel; data only');
}

const collectOptions = (options: CommonOptions): CollectOptions => ({
  providers: options.provider,
  model: options.model,
  config: options.config,
});

async function streamJson(intervalMs: number, options: CommonOptions, withHistory: boolean): Promise<never> {
  const history = new History();
  for (;;) {
    const started = Date.now();
    const snapshot = await collect(collectOptions(options));
    history.record(snapshot);
    process.stdout.write(`${JSON.stringify(withHistory ? { ...snapshot, history } : snapshot)}\n`);
    await sleep(Math.max(0, intervalMs - (Date.now() - started)));
  }
}

// `llm-monitor --json | head` closes our stdout; that is a normal exit, not an error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const program = new Command('llm-monitor')
  .description('Monitor local LLM servers: LiteLLM, llama-swap, oMLX/mlx_lm, Ollama')
  .version(version)
  .showHelpAfterError();

withCommonOptions(program.command('monitor', { isDefault: true }))
  .description('live dashboard (default command)')
  .option('-i, --interval <seconds>', 'refresh interval', parseInterval, 1000)
  .option('-w, --watch <model>', 'alias for --model')
  .action(async (options: CommonOptions & { interval: number; watch?: string }) => {
    options.model ??= options.watch;
    if (options.json) await streamJson(options.interval, options, false);
    await runDashboard({ intervalMs: options.interval, collect: collectOptions(options), quiet: options.quiet });
  });

withCommonOptions(program.command('report'))
  .description('point-in-time snapshot of every provider')
  .option('--markdown', 'emit Markdown')
  .action(async (options: CommonOptions & { markdown?: boolean }) => {
    const snapshot = await collect(collectOptions(options));
    const render = { quiet: options.quiet, filtered: Boolean(options.model) };
    const output = options.json ? toJson(snapshot) : options.markdown ? toMarkdown(snapshot, render) : toText(snapshot, render);
    process.stdout.write(`${output}\n`);
    process.exitCode = exitCode(snapshot.providers, Boolean(options.provider));
  });

withCommonOptions(program.command('providers'))
  .description('list detected providers and their status')
  .action(async (options: CommonOptions) => {
    const snapshot = await collect(collectOptions(options));
    const summary = snapshot.providers.map(({ models, routes, ...provider }) => ({
      ...provider,
      loaded: models.filter((model) => model.loaded).length,
      available: routes?.length ?? models.length,
    }));
    process.stdout.write(`${options.json ? toJson(summary) : providersText(snapshot)}\n`);
    process.exitCode = exitCode(snapshot.providers, Boolean(options.provider));
  });

withCommonOptions(program.command('history'))
  .description('live 60-second tok/s sparklines per loaded model (in-memory only)')
  .option('-i, --interval <seconds>', 'sample interval', parseInterval, 1000)
  .action(async (options: CommonOptions & { interval: number }) => {
    if (options.json) await streamJson(options.interval, options, true);
    await runDashboard({
      intervalMs: options.interval,
      collect: collectOptions(options),
      quiet: options.quiet,
      historyOnly: true,
    });
  });

program
  .command('completion <shell>')
  .description('print shell completion script (bash|zsh); eval "$(llm-monitor completion zsh)"')
  .action((shell: string) => {
    process.stdout.write(completionScript(shell));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`llm-monitor: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
