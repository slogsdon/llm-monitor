import assert from 'node:assert/strict';
import { test } from 'node:test';
import { History, WINDOW_MS, seriesKey, sparkline } from './history.ts';
import type { Snapshot } from './types.ts';

const snapshot = (genTps?: number, loaded = true): Snapshot => ({
  timestamp: 't',
  system: { memTotal: 1, memUsed: 0 },
  providers: [{ provider: 'mlx', label: 'oMLX', url: 'http://x', status: 'up', models: [{ id: 'm', loaded, state: 'ready', genTps }] }],
});

test('sparkline scales to the max and keeps only the last width samples', () => {
  assert.equal(sparkline([0, 4, 8]), '▁▅█');
  assert.equal(sparkline([9, 9, 1, 2], 2), '▅█');
  assert.equal(sparkline([0, 0]), '▁▁');
  assert.equal(sparkline([]), '');
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
