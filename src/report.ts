import {
  MODEL_COLUMNS,
  ROUTE_COLUMNS,
  activeRoutes,
  fitColumns,
  formatRow,
  idleSummary,
  isResident,
  modelRows,
  type Column,
  type ModelRow,
} from './columns.ts';
import { formatBytes, formatPercent } from './format.ts';
import { overallStatus } from './health.ts';
import { OVERALL_LABEL, STATUS_COLOR, STATUS_LABEL, glyphs, levelColor, paint, stateColor, statusDot, terminalSize, type Color } from './text.ts';
import type { ProviderSnapshot, Snapshot, SystemSnapshot } from './types.ts';

export interface RenderOptions {
  quiet?: boolean;
  filtered?: boolean;
  width?: number;
}

export const toJson = (value: unknown): string => JSON.stringify(value, null, 2);

export function systemParts(system: SystemSnapshot): { label: string; value: string; percent?: number }[] {
  const memoryDetail = `${formatBytes(system.memUsed).replace(/[A-Z]+$/, '')}/${formatBytes(system.memTotal)}`;
  const gpuDetail = [system.gpuPowerW !== undefined && `${system.gpuPowerW.toFixed(1)} W`, system.gpuCores && `${system.gpuCores} cores`]
    .filter(Boolean)
    .join(' ');
  return [
    { label: 'CPU', value: `${formatPercent(system.cpuPct)}  ${system.chip ?? ''}`.trimEnd(), percent: system.cpuPct },
    { label: 'GPU', value: `${formatPercent(system.gpuPct)}  ${gpuDetail}`.trimEnd(), percent: system.gpuPct },
    {
      label: 'MEM',
      value: `${formatPercent((system.memUsed / system.memTotal) * 100)}  ${memoryDetail}${system.memPressurePct === undefined ? '' : `  pressure ${formatPercent(system.memPressurePct)}`}`,
      percent: (system.memUsed / system.memTotal) * 100,
    },
  ];
}

export function providerLine(provider: ProviderSnapshot): string {
  const port = provider.url ? `:${new URL(provider.url).port}` : '';
  return paint(STATUS_COLOR[provider.status], `${statusDot(provider.status)} ${provider.label}${port}`);
}

export function providerNotes(providers: ProviderSnapshot[]): string[] {
  return providers.flatMap((provider) => (provider.note ? [`${provider.label}: ${provider.note}`] : []));
}

export function routingProvider(snapshot: Snapshot): ProviderSnapshot | undefined {
  return snapshot.providers.find((provider) => provider.provider === 'litellm' && provider.status !== 'down');
}

function table<T>(columns: Column<T>[], rows: T[], color: (row: T) => Color | undefined): string[] {
  const lines = [paint('dim', `  ${formatRow(columns)}`)];
  for (const row of rows) {
    const line = `  ${formatRow(columns, row)}`;
    const tone = color(row);
    lines.push(tone ? paint(tone, line) : line);
  }
  return lines;
}

export function toText(snapshot: Snapshot, options: RenderOptions = {}): string {
  const width = (options.width ?? terminalSize().columns) - 2;
  const sep = glyphs().separator;
  const lines: string[] = [];
  const rows = modelRows(snapshot);
  const shown = options.filtered ? rows : rows.filter(isResident);

  if (!options.quiet) {
    const status = overallStatus(snapshot.providers);
    lines.push(
      `${paint('bold', 'llm-monitor')} ${sep} ${snapshot.host} ${sep} ${snapshot.timestamp} ${sep} ${paint(STATUS_COLOR[status], OVERALL_LABEL[status])}`,
      '',
      paint('bold', 'System'),
      ...systemParts(snapshot.system).map((part) => `  ${part.label}  ${paint(levelColor(part.percent), part.value)}`),
      '',
    );
  }

  lines.push(paint('bold', 'Models'));
  if (shown.length) lines.push(...table(fitColumns(MODEL_COLUMNS, width), shown, (row) => stateColor(row.state)));
  const idle = idleSummary(rows);
  if (idle && !options.filtered) lines.push(paint('dim', `  ${idle}`));
  if (!shown.length && !idle) lines.push(paint('dim', '  no models'));
  lines.push('');

  const routing = routingProvider(snapshot);
  if (routing) {
    const active = activeRoutes(routing);
    const idleAliases = (routing.routes?.length ?? 0) - active.length;
    lines.push(`${paint('bold', 'Routing')}  ${paint('dim', `LiteLLM ${routing.version ? `v${routing.version}` : ''} ${sep} last ${routing.activityWindowSec ?? 60}s`)}`);
    if (active.length) lines.push(...table(fitColumns(ROUTE_COLUMNS, width), active, (route) => (route.activity?.errors ? 'yellow' : undefined)));
    if (idleAliases > 0) lines.push(paint('dim', `  ${idleAliases} aliases idle`));
    lines.push('');
  }

  lines.push(`${paint('bold', 'Providers')}  ${snapshot.providers.map(providerLine).join('   ')}`);
  for (const note of providerNotes(snapshot.providers)) lines.push(paint('dim', `  ${note}`));
  return lines.join('\n').trimEnd();
}

function markdownTable<T>(columns: Column<T>[], rows: T[]): string[] {
  return [
    `| ${columns.map((column) => column.header).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => column.cell(row)).join(' | ')} |`),
  ];
}

export function toMarkdown(snapshot: Snapshot, options: RenderOptions = {}): string {
  const rows = modelRows(snapshot);
  const shown = options.filtered ? rows : rows.filter(isResident);
  const status = overallStatus(snapshot.providers);
  const lines = options.quiet
    ? []
    : [
        `# llm-monitor — ${snapshot.host} — ${snapshot.timestamp}`,
        '',
        `Status: **${OVERALL_LABEL[status]}**`,
        '',
        '## System',
        '',
        ...systemParts(snapshot.system).map((part) => `- ${part.label}: ${part.value}`),
        '',
      ];

  lines.push('## Models', '');
  if (shown.length) lines.push(...markdownTable(MODEL_COLUMNS, shown), '');
  const idle = idleSummary(rows);
  if (idle && !options.filtered) lines.push(`_${idle}_`, '');

  const routing = routingProvider(snapshot);
  if (routing) {
    const active = activeRoutes(routing);
    lines.push(`## Routing (LiteLLM${routing.version ? ` v${routing.version}` : ''}, last ${routing.activityWindowSec ?? 60}s)`, '');
    if (active.length) lines.push(...markdownTable(ROUTE_COLUMNS, active), '');
    const idleAliases = (routing.routes?.length ?? 0) - active.length;
    if (idleAliases > 0) lines.push(`_${idleAliases} aliases idle_`, '');
  }

  lines.push('## Providers', '');
  for (const provider of snapshot.providers) {
    lines.push(`- ${provider.label}: ${STATUS_LABEL[provider.status]}${provider.url ? ` (${provider.url}` + (provider.version ? `, v${provider.version})` : ')') : ''}${provider.note ? ` — ${provider.note}` : ''}`);
  }
  return lines.join('\n').trimEnd();
}

export function providersText(snapshot: Snapshot): string {
  return snapshot.providers
    .map((provider) => {
      const models = provider.routes
        ? `${provider.routes.length} aliases`
        : provider.status === 'down'
          ? '—'
          : `${provider.models.filter((model) => model.loaded).length}/${provider.models.length} loaded`;
      return [
        paint(STATUS_COLOR[provider.status], `${statusDot(provider.status)} ${provider.label.padEnd(12)}`),
        paint(STATUS_COLOR[provider.status], STATUS_LABEL[provider.status].padEnd(9)),
        (provider.url || '—').padEnd(24),
        (provider.version ? `v${provider.version}` : '—').padEnd(10),
        models,
      ].join(' ');
    })
    .join('\n');
}

export type { ModelRow };
