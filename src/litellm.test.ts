import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITY_TTL_MS, ROUTES_TTL_MS, aggregateActivity, litellm, resetLitellmCaches } from './providers/litellm.ts';

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

// The dashboard polls every few seconds but the route table and the spend-log batch
// both change far more slowly; these tests pin the caching so neither can regress to
// a per-tick fetch.
test('litellm caches the route table and spend activity across polls', async (t) => {
  resetLitellmCaches();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const calls: string[] = [];
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    resetLitellmCaches();
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = url.includes('/health/readiness')
      ? { status: 'healthy', litellm_version: '1.82.6' }
      : url.includes('/model/info')
        ? { data: [{ model_name: 'fast', litellm_params: { model: 'openai/gemma', api_base: 'http://127.0.0.1:8000/v1' } }] }
        : {
            data: [
              {
                model_group: 'fast',
                startTime: new Date(Date.now() - 5000).toISOString(),
                total_tokens: 42,
                request_duration_ms: 900,
                status: 'success',
              },
            ],
          };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const context = { litellmKey: 'sk-test', routes: [] };
  const hits = (fragment: string) => calls.filter((url) => url.includes(fragment)).length;

  const first = await litellm.poll('http://127.0.0.1:4000', context);
  assert.equal(hits('/model/info'), 1, 'route table is fetched on a cold cache');
  assert.equal(hits('/spend/logs/ui'), 1, 'activity is fetched on a cold cache');
  assert.deepEqual(first.routes?.map((route) => route.alias), ['fast']);
  assert.equal(first.routes?.[0]?.activity?.requests, 1);

  await litellm.poll('http://127.0.0.1:4000', context);
  assert.equal(hits('/model/info'), 1, 'a second poll reuses the cached route table');
  assert.equal(hits('/spend/logs/ui'), 1, 'and the cached activity');

  t.mock.timers.setTime(1_000_000 + ACTIVITY_TTL_MS);
  await litellm.poll('http://127.0.0.1:4000', context);
  assert.equal(hits('/spend/logs/ui'), 2, 'activity refreshes on its shorter TTL');
  assert.equal(hits('/model/info'), 1, 'while the route table stays cached');

  t.mock.timers.setTime(1_000_000 + ROUTES_TTL_MS);
  await litellm.poll('http://127.0.0.1:4000', context);
  assert.equal(hits('/model/info'), 2, 'the route table refreshes on its own TTL');
});
