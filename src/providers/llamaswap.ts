import { getJson, getText, reachable } from '../http.ts';
import type { ModelSnapshot, Provider } from '../types.ts';

interface ModelList {
  data?: { id: string; owned_by?: string }[];
}

interface Running {
  running?: { model: string; state: string }[];
}

interface Props {
  default_generation_settings?: { n_ctx?: number };
}

export function parsePrometheus(text: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = /^([^\s{]+)(?:\{[^}]*\})?\s+(-?[\d.eE+-]+|NaN)/.exec(line);
    if (match) metrics[match[1]!] = Number(match[2]);
  }
  return metrics;
}

// Only ever hit /upstream/* for models already in the ready state: llama-swap
// would otherwise treat the request as a trigger to load that model.
async function enrichReady(base: string, model: ModelSnapshot): Promise<void> {
  const upstream = `${base}/upstream/${model.id}`;
  const [metrics, props] = await Promise.all([
    getText(`${upstream}/metrics`).then(parsePrometheus, () => undefined),
    getJson<Props>(`${upstream}/props`).catch(() => undefined),
  ]);
  if (metrics) {
    model.genTps = metrics['llamacpp:predicted_tokens_seconds'];
    model.promptTps = metrics['llamacpp:prompt_tokens_seconds'];
    model.activeRequests = metrics['llamacpp:requests_processing'];
    model.queueDepth = metrics['llamacpp:requests_deferred'];
    model.contextUsed = metrics['llamacpp:kv_cache_tokens'];
  }
  model.contextMax = props?.default_generation_settings?.n_ctx;
}

export const llamaswap: Provider = {
  id: 'llamaswap',
  label: 'llama-swap',
  ports: [8080, 8081, 8082],

  async detect(base) {
    const list = await getJson<ModelList>(`${base}/v1/models`).catch(() => undefined);
    if (!list?.data) return false;
    if (list.data.some((model) => model.owned_by === 'llama-swap')) return true;
    return list.data.length === 0 && reachable(`${base}/running`);
  },

  async poll(base) {
    const [list, running] = await Promise.all([
      getJson<ModelList>(`${base}/v1/models`),
      getJson<Running>(`${base}/running`).catch(() => undefined),
    ]);
    const stateById = new Map((running?.running ?? []).map((entry) => [entry.model, entry.state]));
    const models: ModelSnapshot[] = (list.data ?? []).map((entry) => {
      const state = stateById.get(entry.id) ?? 'idle';
      return { id: entry.id, loaded: state === 'ready', state };
    });
    await Promise.all(models.filter((model) => model.loaded).map((model) => enrichReady(base, model)));

    return {
      provider: 'llamaswap',
      label: 'llama-swap',
      url: base,
      status: running ? 'up' : 'degraded',
      note: running ? undefined : '/running unreachable; load state unknown',
      models,
      extra: { running: models.filter((model) => model.loaded).length, available: models.length },
    };
  },
};
