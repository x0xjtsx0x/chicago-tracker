import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { TILE_URL, TILE_REFERRER_POLICY, tileLayerOptions } from '../../src/web/mapConfig.js';
import { CSP } from '../../src/server/app.js';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
}

describe('map tiles', () => {
  it('tile layer sends a Referer (OSM blocks tile requests without one)', () => {
    const o = tileLayerOptions();
    expect(o.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(o.referrerPolicy).not.toBe('no-referrer');
    // Origin only — never the path or hash of the page.
    expect(['strict-origin-when-cross-origin', 'strict-origin', 'origin', 'origin-when-cross-origin']).toContain(TILE_REFERRER_POLICY);
  });
  it('every L.tileLayer in the web app uses the shared options', () => {
    const calls = walk('src/web').flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/L\.tileLayer\([^\n]*/g)].map((m) => `${f}: ${m[0]}`));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatch(/L\.tileLayer\(TILE_URL,\s*tileLayerOptions\(\)\)/);
  });
  it('the CSP img-src allows the exact tile host', () => {
    const host = new URL(TILE_URL.replace(/\{[a-z]\}/g, '0')).origin;
    const imgSrc = CSP.split('; ').find((d) => d.startsWith('img-src '))!;
    expect(imgSrc.split(' ')).toContain(host);
  });
  it('the global policy stays no-referrer for everything else', () => {
    expect(readFileSync('src/server/app.ts', 'utf8')).toMatch(/'Referrer-Policy', 'no-referrer'/);
  });
});
