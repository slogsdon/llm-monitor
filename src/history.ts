import type { Snapshot } from './types.ts';

export const WINDOW_MS = 60_000;
export const seriesKey = (provider: string, modelId: string) => `${provider}/${modelId}`;

export class History {
  private readonly samples = new Map<string, { at: number; value: number }[]>();
  private readonly lastSeen = new Map<string, number>();

  record(snapshot: Snapshot, now = Date.now()): void {
    const cutoff = now - WINDOW_MS;
    for (const provider of snapshot.providers) {
      for (const model of provider.models) {
        if (!model.loaded) continue;
        const key = seriesKey(provider.provider, model.id);
        const series = this.samples.get(key) ?? [];
        series.push({ at: now, value: model.genTps ?? 0 });
        // Drop expired samples in place: rebuilding the array every tick allocated a
        // fresh one per loaded model per second for no benefit.
        let expired = 0;
        while (expired < series.length && series[expired]!.at <= cutoff) expired++;
        if (expired) series.splice(0, expired);
        this.samples.set(key, series);
        this.lastSeen.set(key, now);
      }
    }
    // Models that stop being loaded (or whose provider disappears) would otherwise
    // pin their series forever — an unbounded map keyed on every id ever seen.
    for (const [key, seen] of this.lastSeen) {
      if (now - seen > WINDOW_MS) {
        this.samples.delete(key);
        this.lastSeen.delete(key);
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
