import type { NotifyCategory } from '../../shared/types.js';

/** ntfy's named priority levels. Internal code uses these names only. */
export type NtfyPriority = 'min' | 'low' | 'default' | 'high' | 'urgent';

/**
 * Explicit mapping to ntfy's numeric codes. The JSON publishing API takes the number
 * (https://docs.ntfy.sh/publish/#message-priority): min=1, low=2, default=3, high=4, urgent=5.
 */
export const NTFY_PRIORITY: Readonly<Record<NtfyPriority, 1 | 2 | 3 | 4 | 5>> = Object.freeze({ min: 1, low: 2, default: 3, high: 4, urgent: 5 });

export interface PlannedPush {
  key: string; category: NotifyCategory; priority: NtfyPriority;
  title: string; message: string; click?: string; tags?: string[]; alsoMark?: string[];
}

/**
 * JSON publishing: POST to the server root with { topic, ... }. Never put titles in headers (non-ASCII).
 * Payloads may go to public ntfy.sh, so callers must never include plates, nicknames or home/watched addresses.
 */
export async function publishNtfy(
  fetchImpl: typeof fetch, server: { url: string; token: string | null }, topic: string,
  push: Pick<PlannedPush, 'title' | 'message' | 'priority' | 'click' | 'tags'>,
): Promise<void> {
  if (!Object.hasOwn(NTFY_PRIORITY, push.priority)) throw new Error(`unknown ntfy priority: ${String(push.priority)}`);
  const body: Record<string, unknown> = { topic, title: push.title, message: push.message, priority: NTFY_PRIORITY[push.priority] };
  if (push.click) body.click = push.click;
  if (push.tags?.length) body.tags = push.tags;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (server.token) headers.Authorization = `Bearer ${server.token}`;
  const res = await fetchImpl(`${server.url.replace(/\/$/, '')}/`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}
