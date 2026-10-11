import type { FetchJson } from '../http/fetchJson.js';

export async function socrataQueryAll(
  fetchJson: FetchJson, base: string, id: string,
  q: { select?: string; where?: string; order?: string },
  opts: { pageSize?: number; appToken?: string | null } = {},
): Promise<any[]> {
  const pageSize = opts.pageSize ?? 50_000;
  const headers: Record<string, string> = opts.appToken ? { 'X-App-Token': opts.appToken } : {};
  const out: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const p = new URLSearchParams({ $limit: String(pageSize), $offset: String(offset), $order: q.order ?? ':id' });
    if (q.select) p.set('$select', q.select);
    if (q.where) p.set('$where', q.where);
    const rows = await fetchJson(`${base}/${id}.json?${p}`, { headers });
    if (!Array.isArray(rows)) throw new Error(`Socrata ${id}: unexpected response`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Escape a value for a SoQL string literal. */
export const soqlStr = (s: string): string => `'${s.replace(/'/g, "''")}'`;
