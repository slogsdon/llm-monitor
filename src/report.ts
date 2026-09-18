import { MODEL_COLUMNS, ROUTE_COLUMNS, displayModels, formatRow, visibleColumns } from './columns.ts';
import { formatBytes, formatPercent } from './format.ts';
import { overallStatus } from './health.ts';
import {
  STATUS_COLOR,
  STATUS_DOT,
  STATUS_LABEL,
  paint,
  pressureColor,
  stateColor,
  terminalSize,
} from './text.ts';
import type { ProviderSnapshot, Snapshot, SystemSnapshot } from './types.ts';

export interface RenderOptions {
  quiet?: boolean;
  filtered?: boolean;
  width?: number;
}

export const toJson = (value: unknown): string => JSON.stringify(value, null, 2);

export function extraLine(snapshot: ProviderSnapshot): string {
  return Object.entries(snapshot.extra ?? {})
    .map(([key, value]) => `${key.replaceAll('_', ' ')} ${value}`)
    .join(' · ');
}

export function providerHeadline(snapshot: ProviderSnapshot): string {
  const parts = [snapshot.label, STATUS_LABEL[snapshot.status]];
  if (snapshot.url) parts.push(snapshot.url);
  if (snapshot.version) parts.push(`v${snapshot.version}`);
  return parts.join('  ');
}

function providerText(snapshot: ProviderSnapshot, width: number, filtered: boolean): string[] {
  const color = STATUS_COLOR[snapshot.status];
  const lines = [paint(color, `${STATUS_DOT[snapshot.status]} ${providerHeadline(snapshot)}`)];
  const details = [extraLine(snapshot), snapshot.note].filter(Boolean).join(' · ');
  if (details) lines.push(paint('dim', `  ${details}`));
  if (snapshot.status === 'down') return lines;

  if (snapshot.routes?.length) {
    const columns = visibleColumns(ROUTE_COLUMNS, width);
    lines.push(paint('dim', `  ${formatRow(columns)}`));
    for (const route of snapshot.routes) lines.push(`  ${formatRow(columns, route)}`);
  }

  const shown = displayModels(snapshot.models, filtered);
  if (shown.length) {
    const columns = visibleColumns(MODEL_COLUMNS, width);
    lines.push(paint('dim', `  ${formatRow(columns)}`));
    for (const model of shown) lines.push(paint(stateColor(model.state), `  ${formatRow(columns, model)}`));
  }
  const hidden = snapshot.models.length - shown.length;
  if (hidden > 0) lines.push(paint('dim', `  +${hidden} idle`));
  return lines;
}

// macOS reports almost no "free" memory once the page cache is warm, so there
// the kernel's pressure level replaces the used/total figure.
export function systemLine(system: SystemSnapshot): string {
  const memory =
    system.memPressurePct === undefined
      ? `mem ${formatBytes(system.memUsed)}/${formatBytes(system.memTotal)} (${formatPercent((system.memUsed / system.memTotal) * 100)})`
      : `mem ${formatBytes(system.memTotal)}  ${paint(pressureColor(system.memPressurePct), `pressure ${formatPercent(system.memPressurePct)}`)}`;
  return [memory, `cpu ${formatPercent(system.cpuPct)}`, 'gpu —', system.chip ?? ''].filter(Boolean).join('  ');
}

export function toText(snapshot: Snapshot, options: RenderOptions = {}): string {
  const width = options.width ?? terminalSize().columns;
  const lines: string[] = [];
  if (!options.quiet) {
    const status = overallStatus(snapshot.providers);
    lines.push(
      `${paint('bold', 'llm-monitor')}  ${snapshot.timestamp}  ${paint(STATUS_COLOR[status], STATUS_LABEL[status])}`,
      '',
    );
  }
  for (const provider of snapshot.providers) {
    lines.push(...providerText(provider, width, Boolean(options.filtered)), '');
  }
  if (!options.quiet) lines.push(`${paint('bold', 'System')}  ${systemLine(snapshot.system)}`);
  return lines.join('\n').trimEnd();
}

function markdownTable<T>(columns: { header: string; cell(row: T): string }[], rows: T[]): string[] {
  return [
    `| ${columns.map((column) => column.header).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${columns.map((column) => column.cell(row)).join(' | ')} |`),
  ];
}

export function toMarkdown(snapshot: Snapshot, options: RenderOptions = {}): string {
  const lines = options.quiet ? [] : [`# llm-monitor report — ${snapshot.timestamp}`, ''];
  for (const provider of snapshot.providers) {
    lines.push(`## ${provider.label} — ${STATUS_LABEL[provider.status]}${provider.url ? ` — ${provider.url}` : ''}`);
    const details = [provider.version && `v${provider.version}`, extraLine(provider), provider.note].filter(Boolean);
    if (details.length) lines.push('', details.join(' · '));
    if (provider.routes?.length) lines.push('', ...markdownTable(ROUTE_COLUMNS, provider.routes));
    const shown = displayModels(provider.models, Boolean(options.filtered));
    if (shown.length) lines.push('', ...markdownTable(MODEL_COLUMNS, shown));
    const hidden = provider.models.length - shown.length;
    if (hidden > 0) lines.push('', `_+${hidden} idle_`);
    lines.push('');
  }
  if (!options.quiet) lines.push('## System', '', systemLine(snapshot.system));
  return lines.join('\n').trimEnd();
}

export function providersText(snapshot: Snapshot): string {
  const rows = snapshot.providers.map((provider) => {
    const models = provider.routes
      ? `${provider.routes.length} aliases`
      : provider.status === 'down'
        ? '—'
        : `${provider.models.filter((model) => model.loaded).length}/${provider.models.length} loaded`;
    return [
      paint(STATUS_COLOR[provider.status], `${STATUS_DOT[provider.status]} ${provider.label.padEnd(16)}`),
      paint(STATUS_COLOR[provider.status], STATUS_LABEL[provider.status].padEnd(9)),
      (provider.url || '—').padEnd(24),
      (provider.version ? `v${provider.version}` : '—').padEnd(10),
      models,
    ].join(' ');
  });
  return rows.join('\n');
}
