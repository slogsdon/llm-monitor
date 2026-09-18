import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIoreg, parsePowermetrics, parseVmStat } from './system.ts';

test('parseVmStat sums wired, anonymous minus purgeable, and compressed pages', () => {
  const text = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                                    1000.',
    'Pages active:                                  5000.',
    'Pages wired down:                               100.',
    'Pages purgeable:                                 10.',
    'Anonymous pages:                                200.',
    'Pages occupied by compressor:                    50.',
  ].join('\n');
  assert.equal(parseVmStat(text), (100 + 200 - 10 + 50) * 16384);
  assert.equal(parseVmStat('garbage'), undefined);
});

test('parseIoreg reads GPU utilisation and core count', () => {
  const text = '| "gpu-core-count" = 10\n| "PerformanceStatistics" = {"Device Utilization %"=23,"Tiler Utilization %"=9}';
  assert.deepEqual(parseIoreg(text), { gpuPct: 23, gpuCores: 10 });
  assert.deepEqual(parseIoreg(''), { gpuPct: undefined, gpuCores: undefined });
});

test('parsePowermetrics converts GPU milliwatts to watts', () => {
  assert.equal(parsePowermetrics('**** GPU usage ****\nGPU Power: 1234 mW\n'), 1.234);
  assert.equal(parsePowermetrics('nothing'), undefined);
});
