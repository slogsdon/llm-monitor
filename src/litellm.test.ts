import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateActivity } from './providers/litellm.ts';

test('aggregateActivity buckets completed requests per alias inside the window', () => {
  const windowStart = new Date('2026-09-18T00:01:00Z');
  const rows = [
    { model_group: 'fast', startTime: '2026-09-18T00:01:10Z', total_tokens: 100, request_duration_ms: 2000, status: 'success' },
    { model_group: 'fast', startTime: '2026-09-18T00:01:20Z', total_tokens: 50, request_duration_ms: 4000, status: 'failure' },
    { model_group: 'max', startTime: '2026-09-18T00:01:30Z', total_tokens: 10, request_duration_ms: 1000, status: 'success' },
    { model_group: 'fast', startTime: '2026-09-18T00:00:59Z', total_tokens: 999, status: 'success' },
    { startTime: '2026-09-18T00:01:40Z', total_tokens: 5 },
  ];
  const activity = aggregateActivity(rows, windowStart);
  assert.deepEqual(activity.get('fast'), { requests: 2, tokens: 150, errors: 1, latencyMs: 3000 });
  assert.deepEqual(activity.get('max'), { requests: 1, tokens: 10, errors: 0, latencyMs: 1000 });
  assert.equal(activity.size, 2);
});
