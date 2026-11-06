import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import handler from '../src/vercel.js';

const server = createServer(handler);
let baseUrl: string;

describe('Vercel deployment configuration', () => {
  it('builds and routes only the dedicated Vercel handler', async () => {
    const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8')) as {
      framework: null;
      builds: Array<{ src: string; use: string; config: { includeFiles: string } }>;
      routes: Array<{ src: string; dest: string }>;
    };

    expect(config.framework).toBeNull();
    expect(config.builds).toEqual([{
      src: 'src/vercel.ts',
      use: '@vercel/node',
      config: { includeFiles: '{public/**,certs/**}' }
    }]);
    expect('functions' in config).toBe(false);
    expect(config.routes).toEqual([{ src: '/(.*)', dest: '/src/vercel.ts' }]);
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

describe('Vercel Fastify entrypoint', () => {
  it('exports a handler that serves the health route and playground assets', async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe('ok');

    const page = await fetch(`${baseUrl}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');

    const styles = await fetch(`${baseUrl}/playground.css`);
    expect(styles.status).toBe(200);
    expect(styles.headers.get('content-type')).toContain('text/css');

    const script = await fetch(`${baseUrl}/playground.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get('content-type')).toContain('javascript');
  });

  it('routes API paths through the same Fastify application', async () => {
    const search = await fetch(`${baseUrl}/api/v1/standards/search?q=x`);
    expect(search.status).toBe(400);

    const detail = await fetch(`${baseUrl}/api/v1/standards/not-a-standard`);
    expect(detail.status).toBe(400);
  });
});
