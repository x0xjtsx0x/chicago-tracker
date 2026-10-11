import { describe, it, expect } from 'vitest';
import { needsStartupRefresh, safely, singleFlight } from '../src/server/scheduler.js';

describe('scheduler helpers', () => {
  it('startup refresh when missing or older than 24h', () => {
    expect(needsStartupRefresh(null, '2026-10-11T12:00:00')).toBe(true);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-11T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(false);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-10T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(true);
  });
  it('singleFlight shares one in-flight run and allows a new run afterwards', async () => {
    let runs = 0;
    let release!: () => void;
    const fn = singleFlight(() => new Promise<number>((r) => { runs++; release = () => r(runs); }));
    const a = fn(), b = fn();          // second caller while the first is running
    expect(runs).toBe(1);
    release();
    expect(await Promise.all([a, b])).toEqual([1, 1]);
    const c = fn();                    // after completion a fresh run starts
    expect(runs).toBe(2);
    release();
    expect(await c).toBe(2);
    const failing = singleFlight(async () => { throw new Error('x'); });
    await expect(failing()).rejects.toThrow('x');
    await expect(failing()).rejects.toThrow('x'); // a failed run does not wedge the gate
  });
  it('safely swallows and logs job errors', async () => {
    const logged: string[] = [];
    await safely('job', async () => { throw new Error('x'); }, { error: (_o, m) => logged.push(m) })();
    expect(logged).toEqual(['job failed']);
  });
});
