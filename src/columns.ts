import { fit, formatBytes, formatContext, formatRate } from './format.ts';
import type { ModelSnapshot, Route } from './types.ts';

export interface Column<T> {
  header: string;
  width: number;
  compact?: boolean;
  align?: 'left' | 'right';
  cell(row: T): string;
}

export const MODEL_COLUMNS: Column<ModelSnapshot>[] = [
  {
    header: 'MODEL',
    width: 44,
    compact: true,
    cell: (model) => {
      const aliases = model.aliases ?? [];
      if (!aliases.length) return model.id;
      const shown = aliases.length > 3 ? [...aliases.slice(0, 2), `+${aliases.length - 2}`] : aliases;
      return `${model.id} (${shown.join(',')})`;
    },
  },
  { header: 'STATE', width: 8, compact: true, cell: (model) => model.state },
  { header: 'GEN t/s', width: 8, compact: true, align: 'right', cell: (model) => formatRate(model.genTps) },
  { header: 'PROMPT t/s', width: 10, align: 'right', cell: (model) => formatRate(model.promptTps) },
  { header: 'MEM', width: 8, align: 'right', cell: (model) => formatBytes(model.memoryBytes) },
  { header: 'CTX', width: 12, align: 'right', cell: (model) => formatContext(model.contextUsed, model.contextMax) },
  {
    header: 'ACT/Q',
    width: 6,
    compact: true,
    align: 'right',
    cell: (model) =>
      model.activeRequests === undefined ? '—' : `${model.activeRequests}/${model.queueDepth ?? 0}`,
  },
];

export const ROUTE_COLUMNS: Column<Route>[] = [
  { header: 'ALIAS', width: 14, compact: true, cell: (route) => route.alias },
  { header: 'MODEL', width: 40, compact: true, cell: (route) => route.model },
  { header: 'BACKEND', width: 40, cell: (route) => route.apiBase || '—' },
];

export const COMPACT_WIDTH = 112;

const GAP = 2;
const INDENT = 2;
const MIN_FIRST_WIDTH = 16;

// Drops non-compact columns under COMPACT_WIDTH, then shrinks the first (name)
// column so the row fits the available width.
export function visibleColumns<T>(columns: Column<T>[], width: number): Column<T>[] {
  const kept = width < COMPACT_WIDTH ? columns.filter((column) => column.compact) : columns;
  const [first, ...rest] = kept;
  if (!first) return kept;
  const restWidth = rest.reduce((sum, column) => sum + column.width + GAP, INDENT);
  const firstWidth = Math.max(MIN_FIRST_WIDTH, Math.min(first.width, width - restWidth));
  return [{ ...first, width: firstWidth }, ...rest];
}

export function formatRow<T>(columns: Column<T>[], row?: T): string {
  return columns
    .map((column) => fit(row === undefined ? column.header : column.cell(row), column.width, column.align))
    .join('  ');
}

// Dashboards show what is resident; an explicit --model filter shows the match
// even when it is idle.
export function displayModels(models: ModelSnapshot[], filtered: boolean): ModelSnapshot[] {
  return filtered ? models : models.filter((model) => model.loaded || model.state === 'loading');
}
