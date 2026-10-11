export type FetchJson = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Origin + path only: query strings can carry plates, addresses and coordinates. */
export function redactUrl(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return '<invalid url>'; }
}

export function createFetchJson(opts: {
  userAgent: string; timeoutMs?: number; retries?: number;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>;
}): FetchJson {
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.retries ?? 2;
  return async (url, init = {}) => {
    let lastErr: unknown = new Error(`request failed for ${redactUrl(url)}`);
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
      try {
        const res = await f(url, {
          method: init.method ?? 'GET',
          body: init.body,
          headers: { 'User-Agent': opts.userAgent, Accept: 'application/json', ...init.headers },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
        if (res.status === 429 || res.status >= 500) { lastErr = new HttpError(res.status, `HTTP ${res.status} for ${redactUrl(url)}`); continue; }
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} for ${redactUrl(url)}`);
        return await res.json();
      } catch (e) {
        if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
        lastErr = e instanceof HttpError ? e : new Error(`network error for ${redactUrl(url)}: ${(e as Error).message}`);
      }
    }
    throw lastErr;
  };
}
