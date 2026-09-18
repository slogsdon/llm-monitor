import type { Status } from './types.ts';

const CODES = { green: 32, yellow: 33, red: 31, cyan: 36, dim: 2, bold: 1 } as const;
export type Color = keyof typeof CODES;

const colorEnabled = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function paint(color: Color, text: string): string {
  return colorEnabled() ? `[${CODES[color]}m${text}[0m` : text;
}

export const STATUS_COLOR: Record<Status, Color> = { up: 'green', degraded: 'yellow', down: 'red' };
export const STATUS_LABEL: Record<Status, string> = { up: 'UP', degraded: 'DEGRADED', down: 'OFFLINE' };
export const OVERALL_LABEL: Record<Status, string> = { up: 'HEALTHY', degraded: 'DEGRADED', down: 'UNREACHABLE' };

export function stateColor(state: string): Color {
  if (state === 'ready') return 'green';
  if (state === 'loading' || state === 'starting' || state === 'stopping') return 'yellow';
  return 'dim';
}

export function levelColor(percent?: number): Color {
  if (percent === undefined) return 'dim';
  return percent >= 85 ? 'red' : percent >= 65 ? 'yellow' : 'green';
}

// Box drawing and block glyphs need a UTF-8 locale; otherwise fall back to ASCII.
let asciiForced = false;
export const setAscii = (value: boolean) => {
  asciiForced = value;
};
export function unicode(): boolean {
  if (asciiForced || process.env.LLM_MONITOR_ASCII) return false;
  return /utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || 'utf-8');
}

export const glyphs = () =>
  unicode()
    ? { dot: { up: '●', degraded: '◐', down: '○' }, filled: '▰', empty: '▱', arrow: '→', separator: '·', bars: '▁▂▃▄▅▆▇█' }
    : { dot: { up: '*', degraded: '+', down: '-' }, filled: '#', empty: '-', arrow: '>', separator: '|', bars: ' .:-=+*#' };

export function statusDot(status: Status): string {
  return glyphs().dot[status];
}

export function meter(percent: number | undefined, width: number): string {
  const { filled, empty } = glyphs();
  if (percent === undefined) return empty.repeat(width);
  const on = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return filled.repeat(on) + empty.repeat(width - on);
}

export function sparkline(values: number[], width: number): string {
  const bars = glyphs().bars;
  const tail = values.slice(-width);
  if (!tail.length) return '';
  const max = Math.max(...tail);
  return tail
    .map((value) => bars[max > 0 ? Math.min(bars.length - 1, Math.floor((value / max) * bars.length)) : 0])
    .join('');
}

// Honour $COLUMNS/$LINES first so panes that set them without a real TTY size
// (herdr, tmux popups) still get a fitted layout.
export function terminalSize(): { columns: number; rows: number } {
  return {
    columns: Number(process.env.COLUMNS) || process.stdout.columns || 80,
    rows: Number(process.env.LINES) || process.stdout.rows || 24,
  };
}
