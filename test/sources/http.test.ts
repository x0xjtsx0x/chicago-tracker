import { describe, it, expect, vi } from 'vitest';
import { createFetchJson, redactUrl } from '../../src/server/http/fetchJson.js';
import { arcgisQueryAll, arcgisQueryNear, arcgisQueryOnce } from '../../src/server/sources/arcgis.js';
import { socrataQueryAll, soqlStr } from '../../src/server/sources/socrata.js';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchJson', () => {
  it('sends User-Agent and retries 5xx then succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(503, {})).mockResolvedValueOnce(res(200, { ok: 1 }));
    const fj = createFetchJson({ userAgent: 'ua-test', fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(await fj('https://x.test/a?plate=ABC123')).toEqual({ ok: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].headers['User-Agent']).toBe('ua-test');
  });
  it('does not retry 4xx and redacts the query string in the error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(400, {}));
    const fj = createFetchJson({ userAgent: 'u', fetchImpl: fetchImpl as any, sleep: async () => {} });
    await expect(fj('https://x.test/a?plate=ABC123')).rejects.toThrow('HTTP 400 for https://x.test/a');
    await expect(fj('https://x.test/a?plate=ABC123')).rejects.not.toThrow(/ABC123/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('network errors are redacted too', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const fj = createFetchJson({ userAgent: 'u', fetchImpl: fetchImpl as any, sleep: async () => {}, retries: 1 });
    await expect(fj('https://x.test/a?plate=ABC123')).rejects.toThrow('network error for https://x.test/a: fetch failed');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('redactUrl strips the query', () => {
    expect(redactUrl('https://h.test/p/q?x=1')).toBe('https://h.test/p/q');
  });
});

describe('arcgisQueryAll', () => {
  it('pages until a short page and always requests outSR=4326', async () => {
    const urls: string[] = [];
    const fj = async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get('resultOffset'));
      const n = offset === 0 ? 2 : 1;
      return { features: Array.from({ length: n }, (_, i) => ({ attributes: { OBJECTID: offset + i } })) };
    };
    const out = await arcgisQueryAll(fj, 'https://g.test/MapServer', 58, {}, 2);
    expect(out.map((f) => f.attributes.OBJECTID)).toEqual([0, 1, 2]);
    expect(urls.every((u) => new URL(u).searchParams.get('outSR') === '4326')).toBe(true);
    expect(urls[0]).toContain('/58/query?');
  });
  it('callers cannot override outSR', async () => {
    let seen = '';
    await arcgisQueryAll(async (u: string) => { seen = u; return { features: [] }; }, 'https://g', 1, { outSR: '3435' });
    expect(new URL(seen).searchParams.get('outSR')).toBe('4326');
  });
  it('arcgisQueryOnce makes exactly one request', async () => {
    let n = 0;
    const out = await arcgisQueryOnce(async () => { n++; return { features: [{ attributes: { A: 1 } }], exceededTransferLimit: true }; }, 'https://g', 1, { resultRecordCount: '1' });
    expect(n).toBe(1);
    expect(out).toHaveLength(1);
  });
  it('throws on an ArcGIS error payload', async () => {
    await expect(arcgisQueryAll(async () => ({ error: { code: 400, message: 'bad' } }), 'https://g', 1)).rejects.toThrow('ArcGIS error 400: bad');
  });
  it('near query sends point geometry + meters distance', async () => {
    let seen = '';
    await arcgisQueryNear(async (u: string) => { seen = u; return { features: [] }; }, 'https://g', 1, [-87.6, 41.8], 250);
    const sp = new URL(seen).searchParams;
    expect(sp.get('geometryType')).toBe('esriGeometryPoint');
    expect(sp.get('inSR')).toBe('4326');
    expect(sp.get('distance')).toBe('250');
    expect(sp.get('units')).toBe('esriSRUnit_Meter');
  });
});

describe('socrataQueryAll', () => {
  it('pages with $limit/$offset and passes the app token header', async () => {
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    const fj = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers });
      const off = Number(new URL(url).searchParams.get('$offset'));
      return off === 0 ? [{ a: 1 }, { a: 2 }] : [{ a: 3 }];
    };
    const rows = await socrataQueryAll(fj, 'https://d.test/resource', 'abcd-1234', { where: "x='1'" }, { pageSize: 2, appToken: 'tok' });
    expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(calls[0].url).toContain('/abcd-1234.json?');
    expect(new URL(calls[0].url).searchParams.get('$where')).toBe("x='1'");
    expect(new URL(calls[0].url).searchParams.get('$order')).toBe(':id');
    expect(calls[0].headers?.['X-App-Token']).toBe('tok');
  });
  it('soqlStr escapes quotes', () => {
    expect(soqlStr("O'BRIEN")).toBe("'O''BRIEN'");
  });
});
