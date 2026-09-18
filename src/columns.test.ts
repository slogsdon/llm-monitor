import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MODEL_COLUMNS, fitColumns, formatRow, modelRows, tableWidth } from './columns.ts';
import type { Snapshot } from './types.ts';

test('fitColumns keeps the full set when it fits, else compact columns with a shrunk name column', () => {
  const full = fitColumns(MODEL_COLUMNS, 200);
  assert.equal(full.length, MODEL_COLUMNS.length);
  const compact = fitColumns(MODEL_COLUMNS, 60);
  assert.deepEqual(compact.map((column) => column.header), ['MODEL', 'BACKEND', 'STATE', 'GEN t/s', 'ACT/Q']);
  assert.equal(tableWidth(compact), 60);
  assert.ok(tableWidth(fitColumns(MODEL_COLUMNS, 30)) >= 30);
});

test('modelRows flattens providers and orders generating, resident, loading, idle', () => {
  const snapshot: Snapshot = {
    timestamp: 't',
    host: 'h',
    system: { memTotal: 1, memUsed: 0 },
    providers: [
      { provider: 'llamaswap', label: 'llama-swap', url: '', status: 'up', models: [{ id: 'z', loaded: false, state: 'idle' }, { id: 'b', loaded: false, state: 'loading' }] },
      { provider: 'mlx', label: 'oMLX', url: '', status: 'up', models: [{ id: 'a', loaded: true, state: 'ready' }, { id: 'c', loaded: true, state: 'ready', activeRequests: 2 }] },
    ],
  };
  const rows = modelRows(snapshot);
  assert.deepEqual(rows.map((row) => `${row.id}@${row.backend}`), ['c@oMLX', 'a@oMLX', 'b@llama-swap', 'z@llama-swap']);
  assert.equal(formatRow(fitColumns(MODEL_COLUMNS, 60), rows[0]!).length, 60);
});
