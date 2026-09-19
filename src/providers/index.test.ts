import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISCOVERY_TTL_MS, pollProviders, resetDiscovery } from './index.ts';
import type { Provider, ProviderSnapshot } from '../types.ts';

// Port probing happens once per tick without the cache; these tests pin the caching
// behaviour so a refactor cannot silently reintroduce the per-tick probe storm.
function fake(options: { live?: string[]; fail?: boolean } = {}) {
  const state = { detects: 0, polls: 0, fail: Boolean(options.fail) };
  const live = options.live ?? ['http://127.0.0.1:8000'];
  const provider: Provider = {
    id: 'mlx',
    label: 'fake',
    ports: [8000, 8001, 8002],
    async detect(base) {
      state.detects += 1;
      return live.includes(base);
    },
    async poll(base): Promise<ProviderSnapshot> {
      state.polls += 1;
      if (state.fail) throw new Error('connection refused');
      return { provider: 'mlx', label: 'fake', url: base, status: 'up', models: [] };
    },
  };
  return { provider, state };
}

test('discovery is cached across polls and re-probed once the TTL expires', async (t) => {
  resetDiscovery();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { provider, state } = fake();
  const context = { routes: [] };

  await pollProviders([provider], context);
  assert.equal(state.detects, 3, 'first poll probes every candidate port');
  assert.equal(state.polls, 1, 'only the live port is polled');

  await pollProviders([provider], context);
  assert.equal(state.detects, 3, 'second poll reuses cached discovery');
  assert.equal(state.polls, 2);

  t.mock.timers.setTime(1_000_000 + DISCOVERY_TTL_MS);
  await pollProviders([provider], context);
  assert.equal(state.detects, 6, 'discovery is re-probed after the TTL');
});

test('an unreachable provider is not re-probed on every poll', async (t) => {
  resetDiscovery();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { provider, state } = fake({ live: [] });

  await pollProviders([provider], { routes: [] });
  assert.equal(state.detects, 3);
  await pollProviders([provider], { routes: [] });
  await pollProviders([provider], { routes: [] });
  assert.equal(state.detects, 3, 'the empty result is cached too');
  assert.equal(state.polls, 0);

  t.mock.timers.setTime(1_000_000 + DISCOVERY_TTL_MS);
  await pollProviders([provider], { routes: [] });
  assert.equal(state.detects, 6, 'a down provider is still retried eventually');
});

test('a failing poll drops the cache so a moved port is picked up next tick', async (t) => {
  resetDiscovery();
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const { provider, state } = fake();
  const context = { routes: [] };

  await pollProviders([provider], context);
  assert.equal(state.detects, 3);

  await pollProviders([provider], context);
  assert.equal(state.detects, 3, 'healthy polls keep using the cache');

  state.fail = true;
  const down = await pollProviders([provider], context);
  assert.equal(down[0]!.status, 'down');
  assert.equal(state.detects, 3, 'the failing poll still used the cache');

  state.fail = false;
  await pollProviders([provider], context);
  assert.equal(state.detects, 6, 'the next poll re-probes ports after a failure');

  await pollProviders([provider], context);
  assert.equal(state.detects, 6, 'the rescan result is cached again');
});
