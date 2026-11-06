import { config } from '../config.js';
import { classifyUpstreamFailure, getErrorDetails, VsqiError } from '../errors.js';
import type { FastifyBaseLogger } from 'fastify';

export class HttpClient {
  constructor(private readonly logger?: Pick<FastifyBaseLogger, 'warn'>) {}

  async getHtml(url: URL): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.HTTP_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const startedAt = performance.now();
      const timeout = setTimeout(() => controller.abort(), config.HTTP_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent': config.HTTP_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'vi,en;q=0.8'
          }
        });

        if (!response.ok) {
          const error = new VsqiError(
            `VSQI returned HTTP ${response.status}`,
            'UPSTREAM_HTTP_ERROR',
            502
          );
          this.logFailure(url, error, attempt + 1, startedAt, {
            failureType: `HTTP_${response.status}`,
            upstreamStatus: response.status,
            contentType: response.headers.get('content-type')
          });
          throw error;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
          const error = new VsqiError('VSQI did not return HTML', 'UNEXPECTED_CONTENT_TYPE', 502);
          this.logFailure(url, error, attempt + 1, startedAt, {
            failureType: 'UNEXPECTED_CONTENT_TYPE',
            upstreamStatus: response.status,
            contentType
          });
          throw error;
        }

        return await response.text();
      } catch (error) {
        lastError = error;
        if (error instanceof VsqiError) throw error;
        this.logFailure(url, error, attempt + 1, startedAt, {
          failureType: classifyUpstreamFailure(error)
        });
        if (attempt < config.HTTP_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (classifyUpstreamFailure(lastError) === 'ETIMEDOUT') {
      throw new VsqiError('VSQI request timed out', 'UPSTREAM_TIMEOUT', 504, { cause: lastError });
    }
    throw new VsqiError('Unable to reach VSQI', 'UPSTREAM_UNAVAILABLE', 502, { cause: lastError });
  }

  private logFailure(url: URL, error: unknown, attempt: number, startedAt: number, extra: object = {}) {
    this.logger?.warn({
      processVersion: process.version,
      nodeOptions: process.env.NODE_OPTIONS ?? '',
      host: url.hostname,
      attempt,
      elapsedMs: Math.round(performance.now() - startedAt),
      failureType: classifyUpstreamFailure(error),
      ...getErrorDetails(error),
      ...extra
    }, 'VSQI upstream request failed');
  }
}
