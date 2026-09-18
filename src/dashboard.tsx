import { Box, Text, render, useApp, useInput, useWindowSize } from 'ink';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { collect, type CollectOptions } from './collect.ts';
import {
  GAP,
  MODEL_COLUMNS,
  ROUTE_COLUMNS,
  activeRoutes,
  fitColumns,
  formatRow,
  idleSummary,
  isResident,
  modelRows,
  tableWidth,
  type Column,
  type ModelRow,
} from './columns.ts';
import { formatBytes } from './format.ts';
import { overallStatus } from './health.ts';
import { History, seriesKey } from './history.ts';
import { providerNotes, routingProvider, systemParts } from './report.ts';
import { OVERALL_LABEL, STATUS_COLOR, glyphs, levelColor, meter, sparkline, stateColor, statusDot, terminalSize, unicode } from './text.ts';
import type { Snapshot } from './types.ts';

export interface DashboardOptions {
  intervalMs: number;
  collect: CollectOptions;
  quiet?: boolean;
  historyOnly?: boolean;
}

const MIN_INTERVAL_MS = 250;
const MAX_INTERVAL_MS = 30_000;
const WIDE_LAYOUT = 110;
const SYSTEM_PANEL_WIDTH = 54;
const METER_WIDTH = 10;

const HISTORY_COLUMNS: Column<ModelRow>[] = MODEL_COLUMNS.filter((column) => ['MODEL', 'BACKEND', 'GEN t/s'].includes(column.header));

// ink cannot label a border, so the top edge is drawn by hand with the title
// inset; the Box below supplies the other three sides.
function Panel({ title, children, width, height }: { title: string; children: ReactNode; width: number; height?: number }) {
  const ascii = !unicode();
  const [left, right, line] = ascii ? ['+', '+', '-'] : ['╭', '╮', '─'];
  const label = ` ${title} `;
  return (
    <Box flexDirection="column" width={width} height={height} flexShrink={0}>
      <Text wrap="truncate">
        <Text color="gray">
          {left}
          {line}
        </Text>
        <Text bold color="cyan">
          {label}
        </Text>
        <Text color="gray">
          {line.repeat(Math.max(0, width - 3 - label.length))}
          {right}
        </Text>
      </Text>
      <Box
        flexDirection="column"
        borderStyle={ascii ? 'classic' : 'round'}
        borderColor="gray"
        borderTop={false}
        paddingX={1}
        flexGrow={1}
        overflow="hidden"
      >
        {children}
      </Box>
    </Box>
  );
}

function Header({ snapshot, intervalMs, paused, staleFor }: { snapshot: Snapshot; intervalMs: number; paused: boolean; staleFor?: number }) {
  const status = overallStatus(snapshot.providers);
  const sep = ` ${glyphs().separator} `;
  const clock = snapshot.timestamp.slice(11, 19);
  return (
    <Box justifyContent="space-between">
      <Text wrap="truncate">
        <Text bold>llm-monitor</Text>
        <Text dimColor>
          {sep}
          {snapshot.host}
        </Text>
      </Text>
      <Text wrap="truncate">
        <Text dimColor>
          {clock}
          {sep}
          {(intervalMs / 1000).toFixed(intervalMs % 1000 ? 2 : 0)}s
          {sep}
        </Text>
        {paused && <Text color="yellow">PAUSED{sep}</Text>}
        {staleFor !== undefined && <Text color="yellow">stale {staleFor}s{sep}</Text>}
        <Text color={STATUS_COLOR[status]} bold>
          {statusDot(status)} {OVERALL_LABEL[status]}
        </Text>
      </Text>
    </Box>
  );
}

function SystemPanel({ snapshot, width }: { snapshot: Snapshot; width: number }) {
  const resident = modelRows(snapshot)
    .filter(isResident)
    .reduce((sum, row) => sum + (row.memoryBytes ?? 0), 0);
  const ceiling = snapshot.providers.reduce((sum, provider) => sum + (provider.modelMemoryMax ?? 0), 0);
  const residentPct = ceiling ? (resident / ceiling) * 100 : undefined;
  return (
    <Panel title="System" width={width}>
      {systemParts(snapshot.system).map((part) => (
        <Text key={part.label} wrap="truncate">
          <Text dimColor>{part.label}</Text>
          {'  '}
          <Text color={levelColor(part.percent)}>{meter(part.percent, METER_WIDTH)}</Text>
          {'  '}
          {part.value}
        </Text>
      ))}
      <Text wrap="truncate">
        <Text dimColor>MDL</Text>
        {'  '}
        <Text color={levelColor(residentPct)}>{meter(residentPct, METER_WIDTH)}</Text>
        {'  '}
        {residentPct === undefined ? '' : `${Math.round(residentPct)}%  `}
        {formatBytes(resident).replace(/[A-Z]+$/, '')}/{formatBytes(ceiling || undefined)} resident
      </Text>
    </Panel>
  );
}

function RoutingPanel({ snapshot, maxRows, width }: { snapshot: Snapshot; maxRows: number; width: number }) {
  const innerWidth = width - 4;
  const routing = routingProvider(snapshot);
  const sep = glyphs().separator;
  if (!routing) {
    return (
      <Panel title="Routing" width={width}>
        <Text dimColor>LiteLLM offline</Text>
      </Panel>
    );
  }
  const active = activeRoutes(routing);
  const shown = active.slice(0, maxRows);
  const idle = (routing.routes?.length ?? 0) - active.length;
  const columns = fitColumns(ROUTE_COLUMNS, innerWidth);
  const title = `Routing ${sep} LiteLLM ${routing.version ? `v${routing.version}` : ''} ${sep} last ${routing.activityWindowSec ?? 60}s`;
  return (
    <Panel title={title} width={width}>
      {shown.length > 0 && <Text dimColor wrap="truncate">{formatRow(columns)}</Text>}
      {shown.map((route) => (
        <Text key={route.alias} color={route.activity?.errors ? 'yellow' : undefined} wrap="truncate">
          {formatRow(columns, route)}
        </Text>
      ))}
      {!shown.length && <Text dimColor>{routing.activityWindowSec ? 'no requests in window' : (routing.note ?? 'no activity data')}</Text>}
      {(active.length > shown.length || idle > 0) && (
        <Text dimColor wrap="truncate">
          {[active.length > shown.length && `+${active.length - shown.length} more`, idle > 0 && `${idle} aliases idle`].filter(Boolean).join(` ${sep} `)}
        </Text>
      )}
    </Panel>
  );
}

function ModelsPanel({
  snapshot,
  history,
  showIdle,
  filtered,
  historyOnly,
  maxRows,
  width,
}: {
  snapshot: Snapshot;
  history: History;
  showIdle: boolean;
  filtered: boolean;
  historyOnly: boolean;
  maxRows: number;
  width: number;
}) {
  const innerWidth = width - 4;
  const rows = modelRows(snapshot);
  const visible = showIdle || filtered ? rows : rows.filter(isResident);
  const shown = visible.slice(0, Math.max(1, maxRows));
  const base = historyOnly ? HISTORY_COLUMNS : MODEL_COLUMNS;
  const spare = innerWidth - tableWidth(fitColumns(base, innerWidth)) - GAP;
  const sparkWidth = spare >= 8 ? Math.min(historyOnly ? 60 : 30, spare) : 0;
  const columns = fitColumns(base, innerWidth - (sparkWidth ? sparkWidth + GAP : 0));
  const sep = glyphs().separator;
  const footer = [visible.length > shown.length && `+${visible.length - shown.length} more`, !showIdle && !filtered && idleSummary(rows)]
    .filter(Boolean)
    .join(` ${sep} `);
  return (
    <Panel title={historyOnly ? 'Models · gen tok/s, last 60s' : 'Models'} width={width}>
      {shown.length > 0 && (
        <Text dimColor wrap="truncate">
          {formatRow(columns)}
          {sparkWidth ? `${' '.repeat(GAP)}60s` : ''}
        </Text>
      )}
      {shown.map((row) => (
        <Text key={`${row.provider}/${row.id}`} color={stateColor(row.state)} dimColor={!isResident(row)} wrap="truncate">
          {formatRow(columns, row)}
          {sparkWidth ? `${' '.repeat(GAP)}${sparkline(history.series(seriesKey(row.provider, row.id)), sparkWidth)}` : ''}
        </Text>
      ))}
      {!shown.length && <Text dimColor>{rows.length ? 'nothing resident' : 'no models discovered'}</Text>}
      {footer && (
        <Text dimColor wrap="truncate">
          {footer}
        </Text>
      )}
    </Panel>
  );
}

function ProviderStrip({ snapshot }: { snapshot: Snapshot }) {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        {snapshot.providers.map((provider, index) => (
          <Text key={provider.label + provider.url} color={STATUS_COLOR[provider.status]}>
            {index ? '   ' : ''}
            {statusDot(provider.status)} {provider.label}
            {provider.url ? `:${new URL(provider.url).port}` : ''}
          </Text>
        ))}
      </Text>
      {providerNotes(snapshot.providers).map((note) => (
        <Text key={note} dimColor wrap="truncate">
          {note}
        </Text>
      ))}
    </Box>
  );
}

const KEYS: [string, string][] = [
  ['q', 'quit'],
  ['p', 'pause'],
  ['+/-', 'interval'],
  ['i', 'idle models'],
  ['?', 'help'],
];

function Footer({ help }: { help: boolean }) {
  return (
    <Text wrap="truncate">
      {help ? (
        <Text dimColor>esc close help</Text>
      ) : (
        KEYS.map(([key, label]) => (
          <Text key={key}>
            <Text bold>{key}</Text>
            <Text dimColor> {label}   </Text>
          </Text>
        ))
      )}
    </Text>
  );
}

function Help({ width }: { width: number }) {
  return (
    <Panel title="Help" width={width}>
      {KEYS.map(([key, label]) => (
        <Text key={key}>
          <Text bold>{key.padEnd(6)}</Text>
          {label}
        </Text>
      ))}
      <Text> </Text>
      <Text dimColor>Models: resident and generating models first; idle collapsed to a count.</Text>
      <Text dimColor>Routing: LiteLLM aliases with completed requests in the last 60s.</Text>
      <Text dimColor>GPU: ioreg utilisation; power needs a sudoers rule for powermetrics (see README).</Text>
      <Text dimColor>MEM: wired + app + compressed, plus the kernel memory-pressure level.</Text>
    </Panel>
  );
}

function Dashboard({ options, history }: { options: DashboardOptions; history: History }) {
  const { exit } = useApp();
  const windowSize = useWindowSize();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [lastOk, setLastOk] = useState<number>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [help, setHelp] = useState(false);
  const [intervalMs, setIntervalMs] = useState(options.intervalMs);
  const intervalRef = useRef(intervalMs);
  intervalRef.current = intervalMs;

  useInput((input, key) => {
    if (input === 'q') exit();
    else if (key.escape) setHelp(false);
    else if (input === '?') setHelp((value) => !value);
    else if (input === 'p') setPaused((value) => !value);
    else if (input === 'i') setShowIdle((value) => !value);
    else if (input === '+' || input === '=') setIntervalMs((value) => Math.min(MAX_INTERVAL_MS, value * 2));
    else if (input === '-') setIntervalMs((value) => Math.max(MIN_INTERVAL_MS, value / 2));
  });

  useEffect(() => {
    if (paused) return;
    let active = true;
    const loop = async () => {
      while (active) {
        try {
          const next = await collect(options.collect);
          history.record(next);
          if (!active) return;
          setSnapshot(next);
          setLastOk(Date.now());
          setError(undefined);
        } catch (caught) {
          if (active) setError(caught instanceof Error ? caught.message : String(caught));
        }
        setNow(Date.now());
        await new Promise((resolve) => setTimeout(resolve, intervalRef.current));
      }
    };
    void loop();
    return () => {
      active = false;
    };
  }, [paused]);

  if (!snapshot) return <Text dimColor>{error ?? 'discovering providers…'}</Text>;

  const columns = Number(process.env.COLUMNS) || windowSize.columns || terminalSize().columns;
  const rows = Number(process.env.LINES) || windowSize.rows || terminalSize().rows;
  const wide = columns >= WIDE_LAYOUT;
  const filtered = Boolean(options.collect.model);
  const staleFor = error && lastOk ? Math.round((now - lastOk) / 1000) : undefined;
  const notes = providerNotes(snapshot.providers).length;

  const routingRows = wide ? 3 : Math.min(3, Math.max(1, Math.floor((rows - 20) / 2)));
  const topHeight = wide ? 6 : 6 + Math.min(routingRows, 1) + 4;
  const chrome = 1 + (options.historyOnly ? 0 : topHeight) + 3 + 1 + notes + 1;
  const modelRowsMax = Math.max(2, rows - chrome - 1);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Header snapshot={snapshot} intervalMs={intervalMs} paused={paused} staleFor={staleFor} />
      {help ? (
        <Help width={columns} />
      ) : (
        <>
          {!options.historyOnly && (
            <Box flexDirection={wide ? 'row' : 'column'} height={wide ? topHeight : undefined}>
              <SystemPanel snapshot={snapshot} width={wide ? SYSTEM_PANEL_WIDTH : columns} />
              <RoutingPanel snapshot={snapshot} maxRows={routingRows} width={wide ? columns - SYSTEM_PANEL_WIDTH : columns} />
            </Box>
          )}
          <ModelsPanel
            snapshot={snapshot}
            history={history}
            showIdle={showIdle}
            filtered={filtered}
            historyOnly={Boolean(options.historyOnly)}
            maxRows={modelRowsMax}
            width={columns}
          />
          <ProviderStrip snapshot={snapshot} />
          <Box flexGrow={1} />
        </>
      )}
      {!options.quiet && <Footer help={help} />}
    </Box>
  );
}

export async function runDashboard(options: DashboardOptions): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error('the live dashboard needs a terminal; use `report`, or `--json` for a stream');
  }
  const app = render(<Dashboard options={options} history={new History()} />, {
    exitOnCtrlC: true,
    alternateScreen: true,
  });
  await app.waitUntilExit();
}
