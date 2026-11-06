import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import type { AddressInfo, LookupFunction } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, type Dispatcher } from 'undici';
import { HttpClient } from '../src/http/http-client.js';
import { createScopedTlsDispatcher, getVsqiTlsDispatcher } from '../src/http/vsqi-tls.js';

const fixture = (name: string) => new URL(`./fixtures/tls/${name}`, import.meta.url);
const targetHost = 'tieuchuan.vsqi.gov.vn';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startTlsServer(certName: string, keyName: string) {
  const server = createHttpsServer({
    cert: await readFile(fixture(certName)),
    key: await readFile(fixture(keyName))
  }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<html>ok</html>');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    url: new URL(`https://${targetHost}:${address.port}/tim-kiem?k=test`)
  };
}

async function fetchWithDispatcher(url: URL, dispatcher: Dispatcher) {
  return fetch(url, {
    dispatcher,
    signal: AbortSignal.timeout(5000)
  } as RequestInit & { dispatcher: Dispatcher });
}

describe('scoped VSQI TLS transport', () => {
  it('uses the pinned supplemental intermediate only for VSQI requests', async () => {
    const intermediate = new X509Certificate(await readFile(
      new URL('../certs/globalsign-gcc-r3-dv-tls-ca-2020.der', import.meta.url)
    ));
    expect(intermediate.fingerprint256)
      .toBe('76:25:38:43:95:09:C4:11:C4:37:D3:C5:67:56:3E:13:78:67:12:81:FC:4A:14:64:AD:D0:31:87:08:43:67:6E');

    const dispatcher = await getVsqiTlsDispatcher();
    expect(dispatcher).toBeInstanceOf(Agent);

    const fetchMock = vi.fn(async () => new Response('<html>ok</html>', {
      headers: { 'content-type': 'text/html' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient();

    await client.getHtml(new URL('https://tieuchuan.vsqi.gov.vn/tim-kiem?k=test'));
    await client.getHtml(new URL('https://example.com/'));

    const vsqiOptions = fetchMock.mock.calls[0]?.[1] as RequestInit & { dispatcher?: Dispatcher };
    const otherOptions = fetchMock.mock.calls[1]?.[1] as RequestInit & { dispatcher?: Dispatcher };
    expect(vsqiOptions.dispatcher).toBe(dispatcher);
    expect(otherOptions.dispatcher).toBeUndefined();
  });

  it('does not apply the supplemental CA to a cross-host redirect', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/final' }
      }))
      .mockResolvedValueOnce(new Response('<html>ok</html>', {
        headers: { 'content-type': 'text/html' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    await new HttpClient().getHtml(new URL('https://tieuchuan.vsqi.gov.vn/start'));

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit & { dispatcher?: Dispatcher }).dispatcher)
      .toBeInstanceOf(Agent);
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit & { dispatcher?: Dispatcher }).dispatcher)
      .toBeUndefined();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://tieuchuan.vsqi.gov.vn/start',
      'https://example.com/final'
    ]);
  });

  it('accepts a chain signed by the scoped CA and still rejects untrusted certificates', async () => {
    const root = await readFile(fixture('test-root.pem'), 'utf8');
    const validServer = await startTlsServer('test-server.pem', 'test-server-key.pem');
    const untrustedServer = await startTlsServer('untrusted-server.pem', 'untrusted-server-key.pem');
    const validDispatcher = createScopedTlsDispatcher(root, {
      hostname: targetHost,
      port: validServer.url.port,
      lookup: testLookup
    });
    const untrustedDispatcher = createScopedTlsDispatcher(root, {
      hostname: targetHost,
      port: untrustedServer.url.port,
      lookup: testLookup
    });
    try {
      const validResponse = await fetchWithDispatcher(validServer.url, validDispatcher);
      expect(validResponse.status).toBe(200);
      await validResponse.body?.cancel();

      await expect(fetchWithDispatcher(untrustedServer.url, untrustedDispatcher))
        .rejects.toMatchObject({ cause: { code: expect.stringMatching(/CERT|SELF_SIGNED/) } });
    } finally {
      await Promise.all([
        validDispatcher.close(),
        untrustedDispatcher.close(),
        closeServer(validServer.server),
        closeServer(untrustedServer.server)
      ]);
    }
  });

  it('rejects a trusted certificate with a hostname mismatch', async () => {
    const root = await readFile(fixture('test-root.pem'), 'utf8');
    const server = await startTlsServer('wrong-host-server.pem', 'test-server-key.pem');
    const dispatcher = createScopedTlsDispatcher(root, {
      hostname: targetHost,
      port: server.url.port,
      lookup: testLookup
    });
    try {
      await expect(fetchWithDispatcher(server.url, dispatcher))
        .rejects.toMatchObject({
          cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }
        });
    } finally {
      await Promise.all([dispatcher.close(), closeServer(server.server)]);
    }
  });

  it('refuses to dispatch the scoped Agent to a different hostname', async () => {
    const root = await readFile(fixture('test-root.pem'), 'utf8');
    const server = await startTlsServer('test-server.pem', 'test-server-key.pem');
    const dispatcher = createScopedTlsDispatcher(root, {
      hostname: targetHost,
      port: server.url.port,
      lookup: testLookup
    });
    const otherHost = new URL(server.url);
    otherHost.hostname = 'wrong.example.test';
    try {
      await expect(fetchWithDispatcher(otherHost, dispatcher))
        .rejects.toMatchObject({
          cause: { message: expect.stringContaining('Scoped VSQI TLS dispatcher cannot connect to another origin') }
        });
    } finally {
      await Promise.all([dispatcher.close(), closeServer(server.server)]);
    }
  });
});

const testLookup: LookupFunction = (_hostname, options, callback) => {
  if (typeof options === 'object' && options.all) {
    callback(null, [{ address: '127.0.0.1', family: 4 }]);
  } else {
    callback(null, '127.0.0.1', 4);
  }
};

function closeServer(server: ReturnType<typeof createHttpsServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
