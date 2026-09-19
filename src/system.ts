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

// Every subprocess spawn allocates its whole output as a transient string —
// `ioreg -c IOAccelerator` alone emits ~47 KB — and the four spawns together cost
// ~17 ms. These values move slowly enough that a human dashboard does not need them
// at the poll interval, so each is cached independently.
const METRIC_TTL_MS = 3_000;
const POWER_TTL_MS = 30_000;

interface Timed<T> {
  at: number;
  value: T;
}

const expires = <T>(entry: Timed<T> | undefined, ttlMs: number): boolean =>
  !entry || Date.now() - entry.at >= ttlMs;

let memUsedCache: Timed<number> | undefined;
let memPressureCache: Timed<number> | undefined;
let gpuCache: Timed<{ gpuPct?: number; gpuCores?: number }> | undefined;
let gpuPowerCache: Timed<number | undefined> | undefined;

async function gpuPower(): Promise<number | undefined> {
  if (!expires(gpuPowerCache, POWER_TTL_MS)) return gpuPowerCache!.value;
  if (powermetricsAllowed === false) {
    gpuPowerCache = { at: Date.now(), value: undefined };
    return undefined;
  }
  const output = await stdout('sudo', ['-n', '/usr/bin/powermetrics', '--samplers', 'gpu_power', '-i', '100', '-n', '1']);
  powermetricsAllowed = output !== undefined;
  const value = output === undefined ? undefined : parsePowermetrics(output);
  gpuPowerCache = { at: Date.now(), value };
  return value;
}

async function memoryUsed(): Promise<number | undefined> {
  if (expires(memUsedCache, METRIC_TTL_MS)) {
    const text = await stdout('/usr/bin/vm_stat', []);
    const used = text === undefined ? undefined : parseVmStat(text);
    if (used !== undefined) memUsedCache = { at: Date.now(), value: used };
  }
  return memUsedCache?.value;
}

async function memoryPressure(): Promise<number | undefined> {
  if (expires(memPressureCache, METRIC_TTL_MS)) {
    const level = await stdout('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_level']);
    if (level !== undefined && Number.isFinite(Number(level.trim()))) {
      memPressureCache = { at: Date.now(), value: 100 - Number(level.trim()) };
    }
  }
  return memPressureCache?.value;
}

async function gpuLoad(): Promise<{ gpuPct?: number; gpuCores?: number } | undefined> {
  if (expires(gpuCache, METRIC_TTL_MS)) {
    const text = await stdout('/usr/sbin/ioreg', ['-r', '-d', '1', '-c', 'IOAccelerator']);
    if (text !== undefined) gpuCache = { at: Date.now(), value: parseIoreg(text) };
  }
  return gpuCache?.value;
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

  const [used, pressure, gpu, power] = await Promise.all([
    memoryUsed(),
    memoryPressure(),
    gpuLoad(),
    gpuPower(),
  ]);
  if (used !== undefined) snapshot.memUsed = used;
  if (pressure !== undefined) snapshot.memPressurePct = pressure;
  if (gpu) Object.assign(snapshot, gpu);
  snapshot.gpuPowerW = power;
  return snapshot;
}
