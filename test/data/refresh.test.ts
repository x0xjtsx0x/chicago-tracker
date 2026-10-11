import { describe, it, expect } from 'vitest';
import { openStore } from '../../src/server/db/store.js';
import { refreshAll, type DatasetJob } from '../../src/server/data/refresh.js';
import { DataCache } from '../../src/server/data/cache.js';

const job = (name: any, rows: unknown[] | Error): DatasetJob => ({
  name, run: async () => { if (rows instanceof Error) throw rows; return { rows, count: rows.length }; },
});

describe('refreshAll', () => {
  it('saves good datasets and isolates failures', async () => {
    const s = openStore(':memory:');
    const r = await refreshAll(s, [job('payBoxes', [{ a: 1 }, { a: 2 }]), job('payBlocks', new Error('down'))], '2026-10-11T03:30:00');
    expect(r.ok).toEqual(['payBoxes']);
    expect(r.failed[0]).toMatchObject({ name: 'payBlocks', error: 'down' });
    expect(s.getDatasetMeta('payBoxes')?.rowCount).toBe(2);
    expect(s.getDatasetMeta('payBlocks')?.status).toBe('error');
  });
  it('rejects zero rows and >50% drops, keeping the previous copy', async () => {
    const s = openStore(':memory:');
    await refreshAll(s, [job('payBoxes', Array.from({ length: 10 }, (_, i) => ({ i })))], 't1');
    const r1 = await refreshAll(s, [job('payBoxes', Array.from({ length: 4 }, (_, i) => ({ i })))], 't2');
    expect(r1.failed[0].error).toMatch(/suspicious row count 4 \(previous 10\)/);
    expect(s.loadDataset<any[]>('payBoxes')).toHaveLength(10);
    const r2 = await refreshAll(s, [job('payBoxes', [])], 't3');
    expect(r2.failed[0].error).toMatch(/suspicious row count 0/);
  });
});

describe('DataCache', () => {
  it('loads empty snapshot when nothing is stored, then reloads', async () => {
    const s = openStore(':memory:');
    const c = new DataCache(s);
    expect(c.snap.payBlocks).toEqual([]);
    expect(c.snap.cbd).toBeNull();
    await refreshAll(s, [job('permitsCurrent', [{ id: 'p1' }]), job('permitsClosures', [{ id: 'p2' }])], 't');
    c.reload();
    expect(c.snap.permits.map((p: any) => p.id).sort()).toEqual(['p1', 'p2']);
    expect(c.asOf().permitsCurrent).toBe('t');
  });
});
