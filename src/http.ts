export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}

async function request(url: string, options: HttpOptions): Promise<Response> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    headers: options.headers,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response;
}

export async function getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  return (await request(url, options)).json() as Promise<T>;
}

export async function getText(url: string, options: HttpOptions = {}): Promise<string> {
  return (await request(url, options)).text();
}

export const reachable = (url: string, options?: HttpOptions): Promise<boolean> =>
  getJson<unknown>(url, options).then(() => true, () => false);
