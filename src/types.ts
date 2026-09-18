export type ProviderId = 'litellm' | 'llamaswap' | 'mlx' | 'ollama';
export type Status = 'up' | 'degraded' | 'down';

export interface ModelSnapshot {
  id: string;
  loaded: boolean;
  state: string;
  memoryBytes?: number;
  contextMax?: number;
  contextUsed?: number;
  genTps?: number;
  promptTps?: number;
  activeRequests?: number;
  queueDepth?: number;
  aliases?: string[];
}

export interface RouteActivity {
  requests: number;
  tokens: number;
  errors: number;
  latencyMs?: number;
}

export interface Route {
  alias: string;
  model: string;
  apiBase: string;
  activity?: RouteActivity;
}

export interface ProviderSnapshot {
  provider: ProviderId;
  label: string;
  url: string;
  status: Status;
  version?: string;
  note?: string;
  models: ModelSnapshot[];
  routes?: Route[];
  activityWindowSec?: number;
  modelMemoryMax?: number;
  extra?: Record<string, string | number>;
}

export interface SystemSnapshot {
  memTotal: number;
  memUsed: number;
  memPressurePct?: number;
  cpuPct?: number;
  gpuPct?: number;
  gpuPowerW?: number;
  gpuCores?: number;
  chip?: string;
}

export interface Snapshot {
  timestamp: string;
  host: string;
  providers: ProviderSnapshot[];
  system: SystemSnapshot;
}

export interface PollContext {
  litellmKey?: string;
  routes: Route[];
}

export interface Provider {
  id: ProviderId;
  label: string;
  ports: number[];
  detect(base: string): Promise<boolean>;
  poll(base: string, context: PollContext): Promise<ProviderSnapshot>;
}
