import assert from 'node:assert/strict';
import { test } from 'node:test';
import { History, WINDOW_MS, seriesKey } from './history.ts';
import { sparkline } from './text.ts';
import type { Snapshot } from './types.ts';

const snapshot = (genTps?: number, loaded = true): Snapshot => ({
  timestamp: 't',
  host: 'h',
  system: { memTotal: 1, memUsed: 0 },
  providers: [{ provider: 'mlx', label: 'oMLX', url: 'http://x', status: 'up', models: [{ id: 'm', loaded, state: 'ready', genTps }] }],
});

test('sparkline scales to the max and keeps only the last width samples', () => {
  assert.equal(sparkline([0, 4, 8], 20), '▁▅█');
  assert.equal(sparkline([9, 9, 1, 2], 2), '▅█');
  assert.equal(sparkline([0, 0], 20), '▁▁');
  assert.equal(sparkline([], 20), '');
});

test('history records idle loaded models as zero and prunes past the window', () => {
  const history = new History();
  const key = seriesKey('mlx', 'm');
  history.record(snapshot(12), 0);
  history.record(snapshot(undefined), 1000);
  history.record(snapshot(undefined, false), 2000);
  assert.deepEqual(history.series(key), [12, 0]);
  history.record(snapshot(3), WINDOW_MS + 1500);
  assert.deepEqual(history.series(key), [3]);
});

test('history evicts series for models that stop being reported', () => {
  const history = new History();
  const key = seriesKey('mlx', 'm');
  const gone = { ...snapshot(5), providers: [] };

  history.record(snapshot(5), 0);
  assert.deepEqual(history.series(key), [5]);

  history.record(gone, 1000);
  assert.deepEqual(history.series(key), [5], 'a brief disappearance keeps the series');

  history.record(gone, WINDOW_MS + 2000);
  assert.deepEqual(history.series(key), [], 'a vanished model is evicted after the window');
  assert.deepEqual(history.toJSON(), {}, 'no keys are retained for the vanished model');
});

// Soak: the dashboard can run for days against a stack where model ids churn (loads,
// reloads, swapped backends). Retention must track the time window, not the number of
// ids ever observed.
test('history stays bounded across a long soak of churning model ids', () => {
  const history = new History();
  const ticks = 500;
  for (let tick = 0; tick < ticks; tick++) {
    history.record(
      {
        ...snapshot(1),
        providers: [
          {
            provider: 'mlx',
            label: 'oMLX',
            url: 'http://x',
            status: 'up',
            models: [{ id: `model-${tick}`, loaded: true, state: 'ready', genTps: tick }],
          },
        ],
      },
      tick * 1000,
    );
  }
  const keys = Object.keys(history.toJSON());
  // 60s window at 1s ticks: only the most recent 61 ids can still be inside it.
  assert.ok(keys.length <= 61, `expected a bounded window, retained ${keys.length} of ${ticks} ids`);
  assert.ok(keys.length > 0, 'the current model is still tracked');
  assert.ok(keys.includes('mlx/model-499'), 'the live model keeps its series');
  assert.ok(!keys.includes('mlx/model-0'), 'a long-gone model is dropped');
});
