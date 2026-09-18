const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)}${UNITS[unit]}`;
}

export function formatRate(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

export function formatCount(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function formatContext(used?: number, max?: number): string {
  if (max === undefined) return '—';
  return `${used === undefined ? '·' : formatCount(used)}/${formatCount(max)}`;
}

export function formatPercent(value?: number): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

export function fit(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const clipped = text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;
  return align === 'right' ? clipped.padStart(width) : clipped.padEnd(width);
}
