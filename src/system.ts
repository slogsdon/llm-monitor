import { execFile } from 'node:child_process';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { SystemSnapshot } from './types.ts';

const run = promisify(execFile);

function readCpu(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    for (const value of Object.values(cpu.times)) total += value;
  }
  return { idle, total };
}

let previous: { idle: number; total: number } | undefined;

// kern.memorystatus_level is the percentage of memory macOS still considers
// available; pressure is the inverse. Not available elsewhere.
async function memoryPressure(): Promise<number | undefined> {
  if (platform() !== 'darwin') return undefined;
  return run('sysctl', ['-n', 'kern.memorystatus_level']).then(
    ({ stdout }) => 100 - Number(stdout.trim()),
    () => undefined,
  );
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  if (!previous) {
    previous = readCpu();
    await sleep(200);
  }
  const current = readCpu();
  const deltaIdle = current.idle - previous.idle;
  const deltaTotal = current.total - previous.total;
  previous = current;

  return {
    memTotal: totalmem(),
    memUsed: totalmem() - freemem(),
    memPressurePct: await memoryPressure(),
    cpuPct: deltaTotal > 0 ? (1 - deltaIdle / deltaTotal) * 100 : undefined,
    chip: cpus()[0]?.model,
  };
}
