import { formatBytes } from '../format.ts';
import { getJson } from '../http.ts';
import type { ModelSnapshot, Provider, ProviderSnapshot } from '../types.ts';

interface OmlxStatus {
  status?: string;
  version?: string;
  loaded_models?: string[];
  active_requests?: number;
  waiting_requests?: number;
  avg_prefill_tps?: number;
  avg_generation_tps?: number;
  model_memory_used?: number;
  model_memory_max?: number;
}

interface OmlxModelEntry {
  id: string;
  loaded?: boolean;
  is_loading?: boolean;
  actual_size?: number | null;
  estimated_size?: number;
  max_context_window?: number;
}

interface OmlxModelsStatus {
  models?: OmlxModelEntry[];
}

interface OmlxRequest {
  tokens_per_second?: number;
  prompt_tokens?: number;
  generated_tokens?: number;
}

interface OmlxActivity {
  active_models?: {
    models?: {
      id: string;
      active_requests?: number;
      waiting_requests?: number;
      generating?: OmlxRequest[];
      prefilling?: OmlxRequest[];
    }[];
  };
}

interface ModelList {
  data?: { id: string; owned_by?: string }[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function mean(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length ? defined.reduce((sum, value) => sum + value, 0) / defined.length : undefined;
}

function maxOrUndefined(values: number[]): number | undefined {
  return values.length ? Math.max(...values) : undefined;
}

async function pollOmlx(base: string, status: OmlxStatus): Promise<ProviderSnapshot> {
  const [modelsStatus, activity] = await Promise.all([
    getJson<OmlxModelsStatus>(`${base}/v1/models/status`).catch(() => undefined),
    getJson<OmlxActivity>(`${base}/admin/api/activity`).catch(() => undefined),
  ]);
  const activityById = new Map((activity?.active_models?.models ?? []).map((entry) => [entry.id, entry]));
  const loadedIds = new Set(status.loaded_models ?? []);

  const entries: OmlxModelEntry[] = modelsStatus?.models ?? [...loadedIds].map((id) => ({ id, loaded: true }));
  const models: ModelSnapshot[] = entries.map((entry) => {
    const loaded = entry.loaded ?? loadedIds.has(entry.id);
    const live = activityById.get(entry.id);
    const generating = live?.generating ?? [];
    return {
      id: entry.id,
      loaded,
      state: entry.is_loading ? 'loading' : loaded ? 'ready' : 'idle',
      memoryBytes: loaded ? (entry.actual_size ?? entry.estimated_size) : undefined,
      contextMax: entry.max_context_window,
      contextUsed: maxOrUndefined(
        generating.map((request) => (request.prompt_tokens ?? 0) + (request.generated_tokens ?? 0)),
      ),
      genTps: mean(generating.map((request) => request.tokens_per_second)),
      promptTps: mean((live?.prefilling ?? []).map((request) => request.tokens_per_second)),
      activeRequests: live?.active_requests,
      queueDepth: live?.waiting_requests,
    };
  });

  return {
    provider: 'mlx',
    label: 'oMLX',
    url: base,
    status: status.status === 'ok' ? 'up' : 'degraded',
    version: status.version,
    note: activity ? undefined : 'activity endpoint unavailable; per-request metrics hidden',
    models,
    extra: {
      avg_gen_tps: status.avg_generation_tps ?? '—',
      avg_prompt_tps: status.avg_prefill_tps ?? '—',
      model_mem: `${formatBytes(status.model_memory_used)}/${formatBytes(status.model_memory_max)}`,
      active: status.active_requests ?? 0,
      waiting: status.waiting_requests ?? 0,
    },
  };
}

async function pollGeneric(base: string): Promise<ProviderSnapshot> {
  const list = await getJson<ModelList>(`${base}/v1/models`);
  return {
    provider: 'mlx',
    label: 'mlx_lm',
    url: base,
    status: 'up',
    models: (list.data ?? []).map((entry) => ({ id: entry.id, loaded: true, state: 'ready' })),
    note: 'generic OpenAI-compatible server; no runtime metrics exposed',
  };
}

export const mlx: Provider = {
  id: 'mlx',
  label: 'MLX',
  ports: [8000, ...range(8080, 8090)],

  async detect(base) {
    const status = await getJson<OmlxStatus>(`${base}/api/status`).catch(() => undefined);
    if (status?.loaded_models) return true;
    const list = await getJson<ModelList>(`${base}/v1/models`).catch(() => undefined);
    return Boolean(list?.data?.length) && !list!.data!.some((model) => model.owned_by === 'llama-swap');
  },

  async poll(base) {
    const status = await getJson<OmlxStatus>(`${base}/api/status`).catch(() => undefined);
    return status?.loaded_models ? pollOmlx(base, status) : pollGeneric(base);
  },
};
