import { describe, it, expect } from 'vitest';
import { needsStartupRefresh, safely } from '../src/server/scheduler.js';

describe('scheduler helpers', () => {
  it('startup refresh when missing or older than 24h', () => {
    expect(needsStartupRefresh(null, '2026-10-11T12:00:00')).toBe(true);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-11T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(false);
    expect(needsStartupRefresh({ name: 'payBlocks', fetchedAt: '2026-10-10T03:30:00', rowCount: 1, status: 'ok', error: null }, '2026-10-11T12:00:00')).toBe(true);
  });
  it('safely swallows and logs job errors', async () => {
    const logged: string[] = [];
    await safely('job', async () => { throw new Error('x'); }, { error: (_o, m) => logged.push(m) })();
    expect(logged).toEqual(['job failed']);
  });
});
