import type { ProviderSnapshot, Status } from './types.ts';

export function overallStatus(snapshots: ProviderSnapshot[]): Status {
  if (snapshots.every((snapshot) => snapshot.status === 'down')) return 'down';
  return snapshots.some((snapshot) => snapshot.status === 'degraded') ? 'degraded' : 'up';
}

// Without an explicit --provider scope, undetected providers are simply absent,
// not failures: only "nothing reachable at all" is exit 2.
export function exitCode(snapshots: ProviderSnapshot[], explicitScope: boolean): 0 | 1 | 2 {
  const statuses = snapshots.map((snapshot) => snapshot.status);
  const unreachable = explicitScope
    ? statuses.includes('down')
    : statuses.every((status) => status === 'down');
  if (unreachable) return 2;
  return statuses.includes('degraded') ? 1 : 0;
}
