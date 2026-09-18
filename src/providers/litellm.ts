import { getJson } from '../http.ts';
import type { Provider, ProviderSnapshot, Route, RouteActivity } from '../types.ts';

interface Readiness {
  status?: string;
  db?: string;
  litellm_version?: string;
}

interface ModelInfo {
  data?: { model_name?: string; litellm_params?: { model?: string; api_base?: string } }[];
}

export interface SpendRow {
  model_group?: string;
  startTime?: string;
  endTime?: string;
  total_tokens?: number;
  request_duration_ms?: number;
  status?: string;
}

interface SpendLogs {
  data?: SpendRow[];
}

export const ACTIVITY_WINDOW_SEC = 60;

function toRoutes(info: ModelInfo): Route[] {
  return (info.data ?? []).flatMap((entry) => {
    const alias = entry.model_name;
    const model = entry.litellm_params?.model;
    return alias && model ? [{ alias, model, apiBase: entry.litellm_params?.api_base ?? '' }] : [];
  });
}

// Spend logs are written on completion (batched, ~10s behind), so "activity"
// is what finished inside the window.
export function aggregateActivity(rows: SpendRow[], windowStart: Date): Map<string, RouteActivity> {
  const byAlias = new Map<string, RouteActivity & { latencySum: number }>();
  for (const row of rows) {
    if (!row.model_group || !row.startTime || new Date(row.startTime) < windowStart) continue;
    const bucket = byAlias.get(row.model_group) ?? {
      requests: 0,
      tokens: 0,
      errors: 0,
      latencySum: 0,
    };
    bucket.requests += 1;
    bucket.tokens += row.total_tokens ?? 0;
    if (row.status && row.status !== 'success') bucket.errors += 1;
    bucket.latencySum += row.request_duration_ms ?? 0;
    byAlias.set(row.model_group, bucket);
  }
  return new Map(
    [...byAlias].map(([alias, bucket]) => [
      alias,
      {
        requests: bucket.requests,
        tokens: bucket.tokens,
        errors: bucket.errors,
        latencyMs: bucket.requests ? bucket.latencySum / bucket.requests : undefined,
      },
    ]),
  );
}

const spendDate = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

async function fetchActivity(base: string, key: string): Promise<Map<string, RouteActivity> | undefined> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - ACTIVITY_WINDOW_SEC * 1000);
  const query = new URLSearchParams({
    start_date: spendDate(windowStart),
    end_date: spendDate(new Date(now.getTime() + 60_000)),
    page_size: '100', // ponytail: API max; paginate if a 60s window ever exceeds 100 requests
  });
  const logs = await getJson<SpendLogs>(`${base}/spend/logs/ui?${query}`, {
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs: 3000,
  }).catch(() => undefined);
  return logs?.data ? aggregateActivity(logs.data, windowStart) : undefined;
}

export const litellm: Provider = {
  id: 'litellm',
  label: 'LiteLLM',
  ports: [4000],

  detect: (base) =>
    getJson<unknown>(`${base}/health/liveliness`).then(
      (body) => typeof body === 'string' && body.includes('alive'),
      () => false,
    ),

  async poll(base, context) {
    const snapshot: ProviderSnapshot = {
      provider: 'litellm',
      label: 'LiteLLM',
      url: base,
      status: 'up',
      models: [],
      routes: [],
    };
    const notes: string[] = [];
    const authorized = context.litellmKey ? { Authorization: `Bearer ${context.litellmKey}` } : undefined;

    const [readiness, info, activity] = await Promise.all([
      getJson<Readiness>(`${base}/health/readiness`).catch(() => undefined),
      authorized ? getJson<ModelInfo>(`${base}/model/info`, { headers: authorized, timeoutMs: 3000 }).catch(() => undefined) : undefined,
      context.litellmKey ? fetchActivity(base, context.litellmKey) : undefined,
    ]);

    snapshot.version = readiness?.litellm_version;
    if (!readiness) {
      snapshot.status = 'degraded';
      notes.push('readiness endpoint unreachable');
    } else if (readiness.status !== 'healthy' || (readiness.db && readiness.db !== 'connected')) {
      snapshot.status = 'degraded';
      notes.push(`readiness: ${readiness.status ?? '?'}, db: ${readiness.db ?? '?'}`);
    }

    if (!context.litellmKey) notes.push('no master key (LITELLM_MASTER_KEY): routes from config, no activity');
    else if (!info) notes.push('/model/info rejected master key');
    snapshot.routes = info ? toRoutes(info) : context.routes;
    if (!snapshot.routes.length) notes.push('no routes found; pass --config');

    if (activity) {
      snapshot.activityWindowSec = ACTIVITY_WINDOW_SEC;
      for (const route of snapshot.routes) route.activity = activity.get(route.alias);
    } else if (context.litellmKey) {
      notes.push('/spend/logs/ui unavailable; alias activity hidden');
    }

    const active = snapshot.routes.filter((route) => route.activity?.requests);
    snapshot.note = notes.join('; ') || undefined;
    snapshot.extra = {
      aliases: snapshot.routes.length,
      active: active.length,
      requests: active.reduce((sum, route) => sum + (route.activity?.requests ?? 0), 0),
    };
    return snapshot;
  },
};
