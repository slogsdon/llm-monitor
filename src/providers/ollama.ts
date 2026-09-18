import { getJson } from '../http.ts';
import type { ModelSnapshot, Provider } from '../types.ts';

interface Version {
  version?: string;
}

interface Ps {
  models?: { name: string; size?: number; size_vram?: number; context_length?: number }[];
}

interface Tags {
  models?: { name: string }[];
}

export const ollama: Provider = {
  id: 'ollama',
  label: 'Ollama',
  ports: [11434],

  detect: (base) =>
    getJson<Version>(`${base}/api/version`).then(
      (body) => typeof body?.version === 'string',
      () => false,
    ),

  async poll(base) {
    const [version, ps, tags] = await Promise.all([
      getJson<Version>(`${base}/api/version`).catch(() => undefined),
      getJson<Ps>(`${base}/api/ps`).catch(() => undefined),
      getJson<Tags>(`${base}/api/tags`).catch(() => undefined),
    ]);
    const running: ModelSnapshot[] = (ps?.models ?? []).map((entry) => ({
      id: entry.name,
      loaded: true,
      state: 'ready',
      memoryBytes: entry.size_vram || entry.size,
      contextMax: entry.context_length,
    }));
    const runningIds = new Set(running.map((model) => model.id));
    const idle: ModelSnapshot[] = (tags?.models ?? [])
      .filter((entry) => !runningIds.has(entry.name))
      .map((entry) => ({ id: entry.name, loaded: false, state: 'idle' }));

    return {
      provider: 'ollama',
      label: 'Ollama',
      url: base,
      status: ps ? 'up' : 'degraded',
      version: version?.version,
      note: ps ? undefined : '/api/ps unreachable; load state unknown',
      models: [...running, ...idle],
      extra: { running: running.length, available: running.length + idle.length },
    };
  },
};
