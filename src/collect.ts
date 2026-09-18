import { loadLiteLLMSettings, type LiteLLMSettings } from './config.ts';
import { pollProviders, selectProviders } from './providers/index.ts';
import { hostname } from 'node:os';
import { systemSnapshot } from './system.ts';
import type { ProviderId, ProviderSnapshot, Route, Snapshot } from './types.ts';

export interface CollectOptions {
  providers?: ProviderId[];
  model?: string;
  config?: string;
}

let settingsCache: { key: string | undefined; value: LiteLLMSettings } | undefined;

function settings(configPath?: string): LiteLLMSettings {
  if (!settingsCache || settingsCache.key !== configPath) {
    settingsCache = { key: configPath, value: loadLiteLLMSettings(configPath) };
  }
  return settingsCache.value;
}

function portOf(apiBase: string): string | undefined {
  try {
    return new URL(apiBase).port || undefined;
  } catch {
    return undefined;
  }
}

// LiteLLM models look like "openai/gemma-4-E4B" or "ollama/qwen3:8b"; the
// backend knows them without the provider prefix.
const stripPrefix = (model: string) => (model.includes('/') ? model.slice(model.indexOf('/') + 1) : model);

export function attachAliases(snapshots: ProviderSnapshot[], fallbackRoutes: Route[] = []): void {
  const liveRoutes = snapshots.flatMap((snapshot) => snapshot.routes ?? []);
  for (const route of liveRoutes.length ? liveRoutes : fallbackRoutes) {
    const port = portOf(route.apiBase);
    if (!port) continue;
    const backendModel = stripPrefix(route.model);
    for (const snapshot of snapshots) {
      if (snapshot.provider === 'litellm' || !snapshot.url.endsWith(`:${port}`)) continue;
      const model = snapshot.models.find((candidate) => candidate.id === backendModel);
      if (model) (model.aliases ??= []).push(route.alias);
    }
  }
}

export function filterModels(snapshots: ProviderSnapshot[], query: string): ProviderSnapshot[] {
  const needle = query.toLowerCase();
  const matches = (...names: (string | undefined)[]) =>
    names.some((name) => name?.toLowerCase().includes(needle));
  return snapshots.map((snapshot) => ({
    ...snapshot,
    models: snapshot.models.filter((model) => matches(model.id, ...(model.aliases ?? []))),
    routes: snapshot.routes?.filter((route) => matches(route.alias, route.model)),
  }));
}

export async function collect(options: CollectOptions = {}): Promise<Snapshot> {
  const { masterKey, routes } = settings(options.config);
  const [providers, system] = await Promise.all([
    pollProviders(selectProviders(options.providers), { litellmKey: masterKey, routes }),
    systemSnapshot(),
  ]);
  attachAliases(providers, routes);
  return {
    timestamp: new Date().toISOString(),
    host: hostname().replace(/\.local$/, ''),
    providers: options.model ? filterModels(providers, options.model) : providers,
    system,
  };
}
