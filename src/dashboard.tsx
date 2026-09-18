import { Box, Text, render, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useState } from 'react';
import { collect, type CollectOptions } from './collect.ts';
import { COMPACT_WIDTH, MODEL_COLUMNS, ROUTE_COLUMNS, displayModels, formatRow, visibleColumns, type Column } from './columns.ts';
import { History, seriesKey, sparkline } from './history.ts';
import { extraLine, providerHeadline, systemLine } from './report.ts';
import { STATUS_COLOR, STATUS_DOT, stateColor, terminalSize } from './text.ts';
import type { ModelSnapshot, ProviderSnapshot, Snapshot } from './types.ts';

export interface DashboardOptions {
  intervalMs: number;
  collect: CollectOptions;
  quiet?: boolean;
  historyOnly?: boolean;
}

const HISTORY_COLUMNS: Column<ModelSnapshot>[] = MODEL_COLUMNS.filter((column) =>
  ['MODEL', 'GEN t/s'].includes(column.header),
);

function ModelRows({
  provider,
  columns,
  history,
  sparkWidth,
  maxRows,
  filtered,
}: {
  provider: ProviderSnapshot;
  columns: Column<ModelSnapshot>[];
  history: History;
  sparkWidth: number;
  maxRows: number;
  filtered: boolean;
}) {
  const shown = displayModels(provider.models, filtered);
  const visible = shown.slice(0, maxRows);
  const hidden = provider.models.length - visible.length;
  if (!shown.length && hidden === 0) return null;
  return (
    <Box flexDirection="column" paddingLeft={2}>
      {visible.length > 0 && (
        <Text dimColor>
          {formatRow(columns)}
          {sparkWidth > 0 ? '  60s' : ''}
        </Text>
      )}
      {visible.map((model) => (
        <Text key={model.id} color={stateColor(model.state)} dimColor={model.state === 'idle'} wrap="truncate">
          {formatRow(columns, model)}
          {sparkWidth > 0 ? `  ${sparkline(history.series(seriesKey(provider.provider, model.id)), sparkWidth)}` : ''}
        </Text>
      ))}
      {hidden > 0 && <Text dimColor>+{hidden} {shown.length > visible.length ? 'more' : 'idle'}</Text>}
    </Box>
  );
}

function ProviderPanel({
  provider,
  width,
  history,
  sparkWidth,
  maxRows,
  filtered,
  historyOnly,
}: {
  provider: ProviderSnapshot;
  width: number;
  history: History;
  sparkWidth: number;
  maxRows: number;
  filtered: boolean;
  historyOnly: boolean;
}) {
  const color = STATUS_COLOR[provider.status];
  const details = [extraLine(provider), provider.note].filter(Boolean).join(' · ');
  const routeColumns = visibleColumns(ROUTE_COLUMNS, width);
  const routes = provider.routes?.slice(0, maxRows) ?? [];
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold wrap="truncate">
        {STATUS_DOT[provider.status]} {providerHeadline(provider)}
      </Text>
      {details && !historyOnly && (
        <Text dimColor wrap="truncate">
          {'  '}
          {details}
        </Text>
      )}
      {provider.status !== 'down' && !historyOnly && routes.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          <Text dimColor wrap="truncate">{formatRow(routeColumns)}</Text>
          {routes.map((route) => (
            <Text key={route.alias} wrap="truncate">
              {formatRow(routeColumns, route)}
            </Text>
          ))}
          {(provider.routes?.length ?? 0) > routes.length && (
            <Text dimColor>+{provider.routes!.length - routes.length} more</Text>
          )}
        </Box>
      )}
      {provider.status !== 'down' && (
        <ModelRows
          provider={provider}
          columns={historyOnly ? HISTORY_COLUMNS : visibleColumns(MODEL_COLUMNS, width - sparkWidth - 2)}
          history={history}
          sparkWidth={sparkWidth}
          maxRows={maxRows}
          filtered={filtered}
        />
      )}
    </Box>
  );
}

function Dashboard({ options, history }: { options: DashboardOptions; history: History }) {
  const { exit } = useApp();
  const window = useWindowSize();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();

  useInput((input) => {
    if (input === 'q') exit();
  });

  useEffect(() => {
    let active = true;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await collect(options.collect);
        history.record(next);
        if (active) {
          setSnapshot(next);
          setError(undefined);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(tick, options.intervalMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (!snapshot) return <Text dimColor>{error ?? 'discovering providers…'}</Text>;

  const columns = Number(process.env.COLUMNS) || window.columns || terminalSize().columns;
  const rows = Number(process.env.LINES) || window.rows || terminalSize().rows;
  const filtered = Boolean(options.collect.model);
  const providerCount = Math.max(1, snapshot.providers.length);
  const fixedLines = (options.quiet ? 0 : 3) + providerCount * 3;
  const maxRows = Math.max(2, Math.floor((rows - fixedLines) / providerCount));
  const tableWidth = (options.historyOnly ? HISTORY_COLUMNS : MODEL_COLUMNS).reduce(
    (sum, column) => sum + column.width + 2,
    2,
  );
  const spare = columns - tableWidth - 2;
  const sparkWidth = options.historyOnly
    ? Math.max(10, Math.min(60, spare))
    : columns < COMPACT_WIDTH
      ? 0
      : Math.max(0, Math.min(30, spare));

  return (
    <Box flexDirection="column">
      {!options.quiet && (
        <Box marginBottom={1}>
          <Text bold>llm-monitor</Text>
          <Text dimColor>
            {'  '}
            {snapshot.timestamp}
            {'  '}every {options.intervalMs / 1000}s{error ? `  error: ${error}` : ''}
          </Text>
        </Box>
      )}
      {snapshot.providers.map((provider) => (
        <ProviderPanel
          key={`${provider.provider}${provider.url}`}
          provider={provider}
          width={columns}
          history={history}
          sparkWidth={sparkWidth}
          maxRows={maxRows}
          filtered={filtered}
          historyOnly={Boolean(options.historyOnly)}
        />
      ))}
      {!options.quiet && (
        <Box>
          <Text bold>System</Text>
          <Text wrap="truncate">
            {'  '}
            {systemLine(snapshot.system)}
          </Text>
          <Text dimColor>{'  q to quit'}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function runDashboard(options: DashboardOptions): Promise<void> {
  const app = render(<Dashboard options={options} history={new History()} />, {
    exitOnCtrlC: true,
    alternateScreen: true,
  });
  await app.waitUntilExit();
}
