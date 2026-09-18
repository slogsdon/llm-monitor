import type { Status } from './types.ts';

const CODES = { green: 32, yellow: 33, red: 31, cyan: 36, dim: 2, bold: 1 } as const;
export type Color = keyof typeof CODES;

const colorEnabled = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

export function paint(color: Color, text: string): string {
  return colorEnabled() ? `[${CODES[color]}m${text}[0m` : text;
}

export const STATUS_COLOR: Record<Status, Color> = { up: 'green', degraded: 'yellow', down: 'red' };
export const STATUS_LABEL: Record<Status, string> = { up: 'UP', degraded: 'DEGRADED', down: 'OFFLINE' };
export const STATUS_DOT: Record<Status, string> = { up: '●', degraded: '◐', down: '○' };

export function stateColor(state: string): Color {
  if (state === 'ready') return 'green';
  if (state === 'loading' || state === 'starting' || state === 'stopping') return 'yellow';
  return 'dim';
}

export function pressureColor(percent?: number): Color {
  if (percent === undefined) return 'dim';
  return percent >= 80 ? 'red' : percent >= 60 ? 'yellow' : 'green';
}

// Honour $COLUMNS/$LINES first so panes that set them without a real TTY size
// (herdr, tmux popups) still get a fitted layout.
export function terminalSize(): { columns: number; rows: number } {
  return {
    columns: Number(process.env.COLUMNS) || process.stdout.columns || 80,
    rows: Number(process.env.LINES) || process.stdout.rows || 24,
  };
}
