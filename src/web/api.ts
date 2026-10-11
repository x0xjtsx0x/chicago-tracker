export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  // X-Requested-With is the CSRF proof the server demands on every mutating /api request: a
  // cross-origin page cannot add it without a CORS preflight, which the server never answers.
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { 'X-Requested-With': 'chicago-tracker', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
