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

export interface Route {
  alias: string;
  model: string;
  apiBase: string;
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
  extra?: Record<string, string | number>;
}

export interface SystemSnapshot {
  memTotal: number;
  memUsed: number;
  memPressurePct?: number;
  cpuPct?: number;
  chip?: string;
}

export interface Snapshot {
  timestamp: string;
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
