import { getJson } from '../http.ts';
import type { Provider, ProviderSnapshot, Route } from '../types.ts';

interface Readiness {
  status?: string;
  db?: string;
  litellm_version?: string;
}

interface ModelInfo {
  data?: { model_name?: string; litellm_params?: { model?: string; api_base?: string } }[];
}

function toRoutes(info: ModelInfo): Route[] {
  return (info.data ?? []).flatMap((entry) => {
    const alias = entry.model_name;
    const model = entry.litellm_params?.model;
    return alias && model ? [{ alias, model, apiBase: entry.litellm_params?.api_base ?? '' }] : [];
  });
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

    const readiness = await getJson<Readiness>(`${base}/health/readiness`).catch(() => undefined);
    snapshot.version = readiness?.litellm_version;
    if (!readiness) {
      snapshot.status = 'degraded';
      notes.push('readiness endpoint unreachable');
    } else if (readiness.status !== 'healthy' || (readiness.db && readiness.db !== 'connected')) {
      snapshot.status = 'degraded';
      notes.push(`readiness: ${readiness.status ?? '?'}, db: ${readiness.db ?? '?'}`);
    }

    if (context.litellmKey) {
      const info = await getJson<ModelInfo>(`${base}/model/info`, {
        headers: { Authorization: `Bearer ${context.litellmKey}` },
        timeoutMs: 3000,
      }).catch(() => undefined);
      if (info) snapshot.routes = toRoutes(info);
      else notes.push('/model/info rejected master key');
    } else {
      notes.push('no master key (set LITELLM_MASTER_KEY); routes read from config');
    }

    if (!snapshot.routes?.length) snapshot.routes = context.routes;
    if (!snapshot.routes.length) notes.push('no routes found; pass --config');

    snapshot.note = notes.join('; ') || undefined;
    snapshot.extra = {
      aliases: snapshot.routes.length,
      backends: new Set(snapshot.routes.map((route) => route.apiBase)).size,
    };
    return snapshot;
  },
};
