import { fit, formatBytes, formatContext, formatCount, formatRate } from './format.ts';
import type { ModelSnapshot, ProviderId, ProviderSnapshot, Route, Snapshot } from './types.ts';

export interface Column<T> {
  header: string;
  width: number;
  compact?: boolean;
  align?: 'left' | 'right';
  cell(row: T): string;
}

export interface ModelRow extends ModelSnapshot {
  provider: ProviderId;
  backend: string;
}

const rank = (row: ModelRow) => (row.activeRequests ? 0 : row.loaded ? 1 : row.state === 'loading' ? 2 : 3);

export function modelRows(snapshot: Snapshot): ModelRow[] {
  return snapshot.providers
    .flatMap((provider) => provider.models.map((model) => ({ ...model, provider: provider.provider, backend: provider.label })))
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export const isResident = (row: ModelRow) => row.loaded || row.state === 'loading' || Boolean(row.activeRequests);

export function idleSummary(rows: ModelRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) if (!isResident(row)) counts.set(row.backend, (counts.get(row.backend) ?? 0) + 1);
  return [...counts].map(([backend, count]) => `${count} idle on ${backend}`).join(' · ');
}

export function activeRoutes(provider: ProviderSnapshot): Route[] {
  return (provider.routes ?? [])
    .filter((route) => route.activity?.requests)
    .sort((a, b) => (b.activity?.requests ?? 0) - (a.activity?.requests ?? 0));
}

export const shortModel = (model: string) => (model.includes('/') ? model.slice(model.indexOf('/') + 1) : model);

export const MODEL_COLUMNS: Column<ModelRow>[] = [
  { header: 'MODEL', width: 32, compact: true, cell: (row) => row.id },
  { header: 'BACKEND', width: 10, compact: true, cell: (row) => row.backend },
  { header: 'STATE', width: 7, compact: true, cell: (row) => row.state },
  { header: 'GEN t/s', width: 7, compact: true, align: 'right', cell: (row) => formatRate(row.genTps) },
  { header: 'PROMPT', width: 7, align: 'right', cell: (row) => formatRate(row.promptTps) },
  { header: 'MEM', width: 7, align: 'right', cell: (row) => formatBytes(row.memoryBytes) },
  { header: 'CTX', width: 11, align: 'right', cell: (row) => formatContext(row.contextUsed, row.contextMax) },
  {
    header: 'ACT/Q',
    width: 5,
    compact: true,
    align: 'right',
    cell: (row) => (row.activeRequests === undefined ? '—' : `${row.activeRequests}/${row.queueDepth ?? 0}`),
  },
];

export const ROUTE_COLUMNS: Column<Route>[] = [
  { header: 'ALIAS', width: 16, compact: true, cell: (route) => route.alias },
  { header: 'MODEL', width: 24, cell: (route) => shortModel(route.model) },
  { header: 'REQ', width: 4, compact: true, align: 'right', cell: (route) => String(route.activity?.requests ?? 0) },
  { header: 'TOK', width: 6, compact: true, align: 'right', cell: (route) => formatCount(route.activity?.tokens) },
  {
    header: 'LAT',
    width: 6,
    compact: true,
    align: 'right',
    cell: (route) => (route.activity?.latencyMs === undefined ? '—' : `${(route.activity.latencyMs / 1000).toFixed(1)}s`),
  },
  { header: 'ERR', width: 3, align: 'right', cell: (route) => String(route.activity?.errors ?? 0) },
];

export const GAP = 2;
const MIN_FIRST_WIDTH = 14;

export function tableWidth<T>(columns: Column<T>[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0) + GAP * (columns.length - 1);
}

// Drops non-compact columns when the full set will not fit, then shrinks the
// first (name) column to the remaining width.
export function fitColumns<T>(columns: Column<T>[], width: number): Column<T>[] {
  const kept = tableWidth(columns) <= width ? columns : columns.filter((column) => column.compact);
  const [first, ...rest] = kept;
  if (!first) return kept;
  const restWidth = tableWidth(rest) + (rest.length ? GAP : 0);
  return [{ ...first, width: Math.max(MIN_FIRST_WIDTH, Math.min(first.width, width - restWidth)) }, ...rest];
}

export function formatRow<T>(columns: Column<T>[], row?: T): string {
  return columns
    .map((column) => fit(row === undefined ? column.header : column.cell(row), column.width, column.align))
    .join(' '.repeat(GAP));
}
