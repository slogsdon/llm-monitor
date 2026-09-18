import type { Snapshot } from './types.ts';

export const WINDOW_MS = 60_000;
const BARS = '▁▂▃▄▅▆▇█';

export function sparkline(values: number[], width = 20): string {
  const tail = values.slice(-width);
  if (!tail.length) return '';
  const max = Math.max(...tail);
  return tail
    .map((value) => BARS[max > 0 ? Math.min(BARS.length - 1, Math.floor((value / max) * BARS.length)) : 0])
    .join('');
}

export const seriesKey = (provider: string, modelId: string) => `${provider}/${modelId}`;

export class History {
  private readonly samples = new Map<string, { at: number; value: number }[]>();

  record(snapshot: Snapshot, now = Date.now()): void {
    for (const provider of snapshot.providers) {
      for (const model of provider.models) {
        if (!model.loaded) continue;
        const key = seriesKey(provider.provider, model.id);
        const series = this.samples.get(key) ?? [];
        series.push({ at: now, value: model.genTps ?? 0 });
        this.samples.set(
          key,
          series.filter((sample) => sample.at > now - WINDOW_MS),
        );
      }
    }
  }

  series(key: string): number[] {
    return (this.samples.get(key) ?? []).map((sample) => sample.value);
  }

  toJSON(): Record<string, number[]> {
    return Object.fromEntries([...this.samples.keys()].map((key) => [key, this.series(key)]));
  }
}
