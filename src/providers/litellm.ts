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

// /model/info is a route table that only changes when the LiteLLM config does, and
// /spend/logs/ui is written upstream in ~10s batches, so re-fetching either at the
// dashboard interval parses identical JSON every tick. Each gets its own TTL; a
// one-shot `report` starts cold and therefore still sees live data.
export const ROUTES_TTL_MS = 30_000;
export const ACTIVITY_TTL_MS = 10_000;

interface Timed<T> {
  at: number;
  value: T;
}

const routesCache = new Map<string, Timed<Route[]>>();
const activityCache = new Map<string, Timed<Map<string, RouteActivity>>>();

/** Drop cached LiteLLM metadata so the next poll re-fetches it. */
export function resetLitellmCaches(): void {
  routesCache.clear();
  activityCache.clear();
}

const fresh = <T>(entry: Timed<T> | undefined, ttlMs: number): boolean =>
  entry !== undefined && Date.now() - entry.at < ttlMs;

async function fetchRoutes(base: string, key?: string): Promise<Route[] | undefined> {
  if (!key) return undefined;
  const cached = routesCache.get(base);
  if (fresh(cached, ROUTES_TTL_MS)) return cached!.value;
  const info = await getJson<ModelInfo>(`${base}/model/info`, {
    headers: { Authorization: `Bearer ${key}` },
    timeoutMs: 3000,
  }).catch(() => undefined);
  if (!info) return undefined;
  const routes = toRoutes(info);
  routesCache.set(base, { at: Date.now(), value: routes });
  return routes;
}

async function fetchActivity(base: string, key: string): Promise<Map<string, RouteActivity> | undefined> {
  const cached = activityCache.get(base);
  if (fresh(cached, ACTIVITY_TTL_MS)) return cached!.value;
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
  if (!logs?.data) return undefined;
  const activity = aggregateActivity(logs.data, windowStart);
  activityCache.set(base, { at: Date.now(), value: activity });
  return activity;
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

    const [readiness, routes, activity] = await Promise.all([
      getJson<Readiness>(`${base}/health/readiness`).catch(() => undefined),
      fetchRoutes(base, context.litellmKey),
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
    else if (!routes) notes.push('/model/info rejected master key');
    snapshot.routes = routes ?? context.routes;
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
