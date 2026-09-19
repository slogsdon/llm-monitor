import type { PollContext, Provider, ProviderId, ProviderSnapshot } from '../types.ts';
import { litellm } from './litellm.ts';
import { llamaswap } from './llamaswap.ts';
import { mlx } from './mlx.ts';
import { ollama } from './ollama.ts';

export const PROVIDERS: Provider[] = [litellm, llamaswap, mlx, ollama];
export const PROVIDER_IDS: ProviderId[] = PROVIDERS.map((provider) => provider.id);
// Ollama is a benchmarking sidecar here, not part of the serving stack: opt in with --provider.
const DEFAULT_PROVIDERS: Provider[] = [litellm, llamaswap, mlx];

export const HOST = process.env.LLM_MONITOR_HOST ?? '127.0.0.1';

export function selectProviders(ids?: ProviderId[]): Provider[] {
  return ids?.length ? PROVIDERS.filter((provider) => ids.includes(provider.id)) : DEFAULT_PROVIDERS;
}

// Port probing is the expensive part of a tick: the default provider set offers 16
// candidate ports, each costing one or two requests (mlx's detect tries /api/status
// then /v1/models), and ~56% of those ports are dead and answer with ECONNREFUSED.
// Caching the result turns a per-tick cost into a per-DISCOVERY_TTL_MS cost.
export const DISCOVERY_TTL_MS = 30_000;

interface Discovery {
  bases: string[];
  at: number;
}

const discovered = new Map<ProviderId, Discovery>();

/** Forget cached discovery so the next poll re-probes ports (used on failure and by tests). */
export function resetDiscovery(id?: ProviderId): void {
  if (id) discovered.delete(id);
  else discovered.clear();
}

async function discover(provider: Provider): Promise<string[]> {
  const cached = discovered.get(provider.id);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.bases;
  const bases = await Promise.all(
    provider.ports.map((port) => {
      const base = `http://${HOST}:${port}`;
      return provider.detect(base).then((found) => (found ? base : undefined));
    }),
  );
  const found = bases.filter((base): base is string => base !== undefined);
  discovered.set(provider.id, { bases: found, at: Date.now() });
  return found;
}

function offline(provider: Provider): ProviderSnapshot {
  return {
    provider: provider.id,
    label: provider.label,
    url: '',
    status: 'down',
    note: `not listening on ${HOST}:${provider.ports.length > 3 ? `${provider.ports[0]}…` : provider.ports.join(',')}`,
    models: [],
  };
}

async function pollBase(provider: Provider, base: string, context: PollContext): Promise<ProviderSnapshot> {
  try {
    return await provider.poll(base, context);
  } catch (error) {
    return {
      provider: provider.id,
      label: provider.label,
      url: base,
      status: 'down',
      note: error instanceof Error ? error.message : String(error),
      models: [],
    };
  }
}

export async function pollProviders(providers: Provider[], context: PollContext): Promise<ProviderSnapshot[]> {
  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      const bases = await discover(provider);
      if (!bases.length) return [offline(provider)];
      const snapshots = await Promise.all(bases.map((base) => pollBase(provider, base, context)));
      // A known-good endpoint going down means the port map may have moved (server
      // restarted on a different port), so drop the cache and re-probe next tick.
      if (snapshots.some((snapshot) => snapshot.status === 'down')) resetDiscovery(provider.id);
      if (snapshots.length > 1) {
        for (const snapshot of snapshots) snapshot.label = `${snapshot.label} :${new URL(snapshot.url).port}`;
      }
      return snapshots;
    }),
  );
  return perProvider.flat();
}
