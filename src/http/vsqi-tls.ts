import { readFile } from 'node:fs/promises';
import { X509Certificate } from 'node:crypto';
import type { LookupFunction } from 'node:net';
import * as tls from 'node:tls';
import { Agent, buildConnector } from 'undici';

const VSQI_HOST = 'tieuchuan.vsqi.gov.vn';
const EXPECTED_INTERMEDIATE_FINGERPRINT =
  '76:25:38:43:95:09:C4:11:C4:37:D3:C5:67:56:3E:13:78:67:12:81:FC:4A:14:64:AD:D0:31:87:08:43:67:6E';
const intermediatePath = new URL('../../certs/globalsign-gcc-r3-dv-tls-ca-2020.der', import.meta.url);

let dispatcherPromise: Promise<Agent> | undefined;

export type ScopedTlsDispatcherOptions = {
  hostname?: string;
  port?: string;
  lookup?: LookupFunction;
};

export function usesVsqiHost(url: URL): boolean {
  return url.protocol === 'https:'
    && url.hostname.toLowerCase() === VSQI_HOST
    && (url.port === '' || url.port === '443');
}

export async function getVsqiTlsDispatcher(): Promise<Agent> {
  dispatcherPromise ??= createVsqiTlsDispatcher();
  return dispatcherPromise;
}

export function createScopedTlsDispatcher(
  supplementalCertificate: string,
  { hostname = VSQI_HOST, port = '443', lookup }: ScopedTlsDispatcherOptions = {}
): Agent {
  const scopedConnector = buildConnector({
    ca: [...tls.getCACertificates('default'), supplementalCertificate],
    rejectUnauthorized: true,
    ...(lookup ? { lookup } : {})
  });

  return new Agent({
    connect: (options, callback) => {
      const actualPort = options.port || (options.protocol === 'https:' ? '443' : '80');
      if (options.protocol !== 'https:'
          || options.hostname.toLowerCase() !== hostname.toLowerCase()
          || actualPort !== port) {
        callback(new Error(
          `Scoped VSQI TLS dispatcher cannot connect to another origin: ${options.protocol}//${options.hostname}:${actualPort}`
        ), null);
        return;
      }
      scopedConnector(options, callback);
    }
  });
}

async function createVsqiTlsDispatcher(): Promise<Agent> {
  const certificate = new X509Certificate(await readFile(intermediatePath));
  if (certificate.fingerprint256 !== EXPECTED_INTERMEDIATE_FINGERPRINT) {
    throw new Error('Bundled VSQI TLS intermediate certificate fingerprint mismatch');
  }
  const now = Date.now();
  if (now < Date.parse(certificate.validFrom) || now > Date.parse(certificate.validTo)) {
    throw new Error('Bundled VSQI TLS intermediate certificate is outside its validity period');
  }

  return createScopedTlsDispatcher(certificate.toString());
}
