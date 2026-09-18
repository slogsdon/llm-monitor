import { execFile } from 'node:child_process';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import type { SystemSnapshot } from './types.ts';

const run = promisify(execFile);
const darwin = platform() === 'darwin';

async function stdout(command: string, args: string[]): Promise<string | undefined> {
  return run(command, args, { timeout: 2000 }).then(({ stdout }) => stdout, () => undefined);
}

function readCpu(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    for (const value of Object.values(cpu.times)) total += value;
  }
  return { idle, total };
}

// Activity Monitor's "Memory Used": wired + anonymous (minus purgeable) + compressed.
export function parseVmStat(text: string): number | undefined {
  const pageSize = Number(/page size of (\d+)/.exec(text)?.[1] ?? 16384);
  const pages = (label: string) => Number(new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text)?.[1] ?? NaN);
  const used =
    pages('Pages wired down') + pages('Anonymous pages') - pages('Pages purgeable') + pages('Pages occupied by compressor');
  return Number.isFinite(used) ? used * pageSize : undefined;
}

export function parseIoreg(text: string): { gpuPct?: number; gpuCores?: number } {
  const utilisation = /"Device Utilization %"=(\d+)/.exec(text)?.[1];
  const cores = /"gpu-core-count"\s*=\s*(\d+)/.exec(text)?.[1];
  return {
    gpuPct: utilisation === undefined ? undefined : Number(utilisation),
    gpuCores: cores === undefined ? undefined : Number(cores),
  };
}

export function parsePowermetrics(text: string): number | undefined {
  const milliwatts = /GPU Power:\s*(\d+)\s*mW/.exec(text)?.[1];
  return milliwatts === undefined ? undefined : Number(milliwatts) / 1000;
}

// powermetrics needs root; probe `sudo -n` once so a missing sudoers rule costs
// a single failed call per process rather than one per tick.
let powermetricsAllowed: boolean | undefined;

async function gpuPower(): Promise<number | undefined> {
  if (powermetricsAllowed === false) return undefined;
  const output = await stdout('sudo', ['-n', '/usr/bin/powermetrics', '--samplers', 'gpu_power', '-i', '100', '-n', '1']);
  powermetricsAllowed = output !== undefined;
  return output === undefined ? undefined : parsePowermetrics(output);
}

let previous: { idle: number; total: number } | undefined;

export async function systemSnapshot(): Promise<SystemSnapshot> {
  if (!previous) {
    previous = readCpu();
    await sleep(200);
  }
  const current = readCpu();
  const deltaIdle = current.idle - previous.idle;
  const deltaTotal = current.total - previous.total;
  previous = current;

  const snapshot: SystemSnapshot = {
    memTotal: totalmem(),
    memUsed: totalmem() - freemem(),
    cpuPct: deltaTotal > 0 ? (1 - deltaIdle / deltaTotal) * 100 : undefined,
    chip: cpus()[0]?.model,
  };
  if (!darwin) return snapshot;

  const [vmStat, level, ioreg, power] = await Promise.all([
    stdout('/usr/bin/vm_stat', []),
    stdout('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level']),
    stdout('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']),
    gpuPower(),
  ]);
  const used = vmStat && parseVmStat(vmStat);
  if (used) snapshot.memUsed = used;
  if (level) snapshot.memPressurePct = 100 - Number(level.trim());
  if (ioreg) Object.assign(snapshot, parseIoreg(ioreg));
  snapshot.gpuPowerW = power;
  return snapshot;
}
