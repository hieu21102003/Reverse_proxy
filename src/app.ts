import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { config } from './config.js';
import { VsqiProvider } from './providers/vsqi.provider.js';
import { VsqiError } from './errors.js';
import { CachedStandardProvider } from './services/response-cache.js';
import type { StandardProvider } from './types.js';

const standardCodeSchema = z.string()
  .trim()
  .transform(code => code.replace(/\s+/g, ' ').replace(/\s*:\s*/, ':'))
  .transform(code => code.replace(/^(tcvn|qcvn)/i, prefix => prefix.toUpperCase()))
  .pipe(z.string().regex(/^(?:TCVN|QCVN)\s+\d[\d./-]*:\d{4}(?:\/[A-Z0-9.-]+)?$/i));

export async function createApp(provider: StandardProvider = new VsqiProvider()) {
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
  const cachedProvider = new CachedStandardProvider(provider);

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
      request.log.error({ err: error }, 'VSQI search failed');
      if (error instanceof VsqiError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          source: 'VSQI'
        });
      }
      return reply.code(502).send({
        error: { code: 'UPSTREAM_ERROR', message: 'Unable to retrieve standards from upstream source' },
        source: 'VSQI'
      });
    }
  });

  app.get('/api/v1/standards/:code', {
    config: { rateLimit: { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW } }
  }, async (request, reply) => {
    const parsed = z.object({ code: standardCodeSchema }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: 'INVALID_CODE', message: 'Invalid standard code' } });
    }

    try {
      const result = await cachedProvider.getDetail(parsed.data.code);
      if (!result) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Standard not found' },
          source: 'VSQI'
        });
      }
      return reply.send({ data: result });
    } catch (error) {
      request.log.error({ err: error }, 'VSQI detail lookup failed');
      if (error instanceof VsqiError) {
        return reply.code(error.statusCode).send({
          error: { code: error.code, message: error.message },
          source: 'VSQI'
        });
      }
      return reply.code(502).send({
        error: { code: 'UPSTREAM_ERROR', message: 'Unable to retrieve standard detail' },
        source: 'VSQI'
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
