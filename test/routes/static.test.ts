import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestApp, asUser, OWNER } from '../helpers/testApp.js';

function webRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ct-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>shell</title>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  return dir;
}

describe('static web app', () => {
  it('serves built assets with their own MIME type and security headers', async () => {
    const { app } = await makeTestApp({ webRoot: webRoot() });
    const r = await app.inject({ method: 'GET', url: '/assets/index-abc.js' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('javascript');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('a missing asset is a 404, never the HTML shell', async () => {
    const { app } = await makeTestApp({ webRoot: webRoot() });
    const r = await app.inject({ method: 'GET', url: '/assets/index-old.js' });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).not.toContain('text/html');
  });
  it('extension-less paths fall back to the app shell; /api and /cal do not', async () => {
    const { app } = await makeTestApp({ webRoot: webRoot() });
    const shell = await app.inject({ method: 'GET', url: '/settings' });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain('<title>shell</title>');
    expect((await app.inject({ method: 'GET', url: '/api/nope', headers: asUser(OWNER) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/cal/nope' })).statusCode).toBe(404);
  });
});
