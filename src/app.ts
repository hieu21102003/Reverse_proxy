import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { MergedStandardProvider } from './providers/merged.provider.js';
import { VsqiError } from './errors.js';
import { CachedStandardProvider } from './services/response-cache.js';
import type { StandardProvider, StandardSource } from './types.js';

/** Organisation words that may start a standard code. */
const KNOWN_CODE_ORGS = new Set([
  'TCVN', 'QCVN', 'ISO', 'IEC', 'ASTM', 'BS', 'DIN', 'EN', 'JIS', 'UL',
  'ANSI', 'AS', 'GB'
]);

/**
 * Normalise a user-supplied standard code, or return null when it is not a
 * plausible code. Accepts multi-organisation codes ("EN ISO 9001",
 * "DIN EN ISO 9001", "GB/T 19001", "ASTM E8/E8M", "JIS Q 9001"), codes
 * with or without a year ("ISO 9001", "TCVN 9143:2022"), and the old
 * TCVN|QCVN-only shapes. Rejects anything without a digit, without a known
 * leading organisation, or with characters outside the code alphabet.
 */
export function normalizeStandardCode(raw: string): string | null {
  const code = raw.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':');
  if (code.length < 3 || code.length > 80) return null;
  if (!/[0-9]/.test(code)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./:+\/-]*$/.test(code)) return null;
  const firstToken = code.split(' ')[0]?.split('/')[0]?.toUpperCase();
  if (!firstToken || !KNOWN_CODE_ORGS.has(firstToken)) return null;
  // Upper-case the leading organisation tokens ("en iso 9001" -> "EN ISO 9001").
  const tokens = code.split(' ');
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] as string;
    const head = token.split('/')[0]?.toUpperCase();
    if (!head || !KNOWN_CODE_ORGS.has(head)) break;
    tokens[index] = token.toUpperCase();
    index++;
  }
  return tokens.join(' ');
}

const standardCodeSchema = z.string()
  .transform((raw) => normalizeStandardCode(raw))
  .refine((code): code is string => code !== null, { message: 'Invalid standard code' });

const sourceSchema = z.enum(['VSQI', 'TCVN_VN', 'TCVN_QT']);

export async function createApp(provider?: StandardProvider) {
  const app = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.url'],
        censor: '[Redacted]'
      }
    },
    bodyLimit: 16 * 1024
  });
  const cachedProvider = new CachedStandardProvider(
    provider ?? new MergedStandardProvider(undefined, app.log)
  );

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        connectSrc: ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*']
      }
    }
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
    global: false,
    errorResponseBuilder: (_request, context) => Object.assign(
      new Error('Too many requests; please try again later'),
      { code: 'RATE_LIMIT_EXCEEDED', statusCode: context.statusCode }
    )
  });

  app.setErrorHandler((error, request, reply) => {
    const errorCode = error instanceof Error && 'code' in error ? error.code : undefined;
    if (errorCode === 'RATE_LIMIT_EXCEEDED') {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests; please try again later'
        }
      });
    }

    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
    });
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (config.CORS_ORIGIN) {
      reply.header('Vary', 'Origin');
      if (origin === config.CORS_ORIGIN) {
        reply.header('Access-Control-Allow-Origin', config.CORS_ORIGIN);
      }
      if (origin === config.CORS_ORIGIN && request.method === 'OPTIONS') {
        reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        reply.header('Access-Control-Max-Age', '600');
      }
    }
    if (config.CORS_ORIGIN && request.method === 'OPTIONS' && request.url.startsWith('/api/v1/')) {
      return reply.code(204).send();
    }
  });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'vsqi-proxy-api',
    timestamp: new Date().toISOString()
  }));

  app.get('/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');
    return reply.send(await readFile(new URL('../public/index.html', import.meta.url)));
  });
  app.get('/playground.css', async (_request, reply) => {
    reply.type('text/css; charset=utf-8').header('Cache-Control', 'no-cache');
    return reply.send(await readFile(new URL('../public/playground.css', import.meta.url)));
  });
  app.get('/playground.js', async (_request, reply) => {
    reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'no-cache');
    return reply.send(await readFile(new URL('../public/playground.js', import.meta.url)));
  });

  app.get('/api/v1/standards/search', {
    config: { rateLimit: { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW } }
  }, async (request, reply) => {
    const schema = z.object({
      q: z.string().trim().min(2).max(120),
      page: z.coerce.number().int().min(1).max(1000).default(1)
    });
    const parsed = schema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_QUERY', message: 'q must be 2-120 characters and page must be >= 1' }
      });
    }

    try {
      const result = await cachedProvider.search({ query: parsed.data.q, page: parsed.data.page });
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Merged search failed');
      if (error instanceof VsqiError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          source: 'MULTI'
        });
      }
      return reply.code(502).send({
        error: { code: 'UPSTREAM_ERROR', message: 'Unable to retrieve standards from upstream sources' },
        source: 'MULTI'
      });
    }
  });

  app.get('/api/v1/standards/:code', {
    config: { rateLimit: { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW } }
  }, async (request, reply) => {
    const codeParsed = standardCodeSchema.safeParse(
      (request.params as { code: string }).code
    );
    if (!codeParsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid standard code' } });
    }
    const sourceParsed = sourceSchema.optional().safeParse(
      (request.query as { source?: string }).source
    );
    if (!sourceParsed.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_SOURCE', message: 'source must be VSQI, TCVN_VN or TCVN_QT' }
      });
    }
    const requestedSource: StandardSource | undefined = sourceParsed.data;
    const errorSource: StandardSource | 'MULTI' = requestedSource ?? 'MULTI';

    try {
      const result = await cachedProvider.getDetail(codeParsed.data, requestedSource);
      if (!result) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Standard not found' },
          source: errorSource
        });
      }
      return reply.send({ data: result });
    } catch (error) {
      request.log.error({ err: error }, 'Detail lookup failed');
      if (error instanceof VsqiError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          source: errorSource
        });
      }
      return reply.code(502).send({
        error: { code: 'UPSTREAM_ERROR', message: 'Unable to retrieve standard detail' },
        source: errorSource
      });
    }
  });

  app.route({
    method: 'OPTIONS',
    url: '/api/v1/standards/search',
    config: { rateLimit: false },
    handler: async (_request, reply) => reply.code(204).send()
  });
  app.route({
    method: 'OPTIONS',
    url: '/api/v1/standards/:code',
    config: { rateLimit: false },
    handler: async (_request, reply) => reply.code(204).send()
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found' } });
  });

  return app;
}
