import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []; });
}

describe('web app has no HTML string sinks', () => {
  const files = walk('src/web');
  it('never assigns innerHTML/outerHTML or uses insertAdjacentHTML', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/);
  });
  it('Leaflet tooltips and popups always get a DOM node (string content becomes innerHTML)', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\.bind(Tooltip|Popup)\(\s*([^)]{0,3})/g)) expect(m[2].startsWith('h('), `${f}: .bind${m[1]}(${m[2]}…`).toBe(true);
    }
  });
});
