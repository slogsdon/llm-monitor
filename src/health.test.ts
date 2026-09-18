import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exitCode, overallStatus } from './health.ts';
import type { ProviderSnapshot, Status } from './types.ts';

const snap = (status: Status): ProviderSnapshot => ({
  provider: 'mlx',
  label: 'x',
  url: '',
  status,
  models: [],
});

test('exit 0 when everything reachable is healthy, ignoring undetected providers', () => {
  assert.equal(exitCode([snap('up'), snap('down')], false), 0);
});

test('exit 1 on any degraded provider', () => {
  assert.equal(exitCode([snap('up'), snap('degraded')], false), 1);
  assert.equal(exitCode([snap('degraded')], true), 1);
});

test('exit 2 when nothing is reachable, or a requested provider is down', () => {
  assert.equal(exitCode([snap('down'), snap('down')], false), 2);
  assert.equal(exitCode([], false), 2);
  assert.equal(exitCode([snap('up'), snap('down')], true), 2);
});

test('overallStatus mirrors the exit code buckets', () => {
  assert.equal(overallStatus([snap('up'), snap('down')]), 'up');
  assert.equal(overallStatus([snap('up'), snap('degraded')]), 'degraded');
  assert.equal(overallStatus([snap('down')]), 'down');
});
