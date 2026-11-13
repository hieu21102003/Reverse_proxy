import { config } from '../config.js';
import { classifyUpstreamFailure, getErrorDetails, VsqiError } from '../errors.js';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Minimal JSON client for the tracuu.tcvn.vn front-api.
 *
 * Deliberately separate from the VSQI HTML HttpClient: different content
 * type, no VSQI TLS dispatcher, and a hard origin allowlist. It only ever
 * talks to the configured TCVN base origin (HTTP by default — the host
 * resets HTTPS connections) and follows redirects only within that origin.
 * It never logs response bodies: TCVN detail responses embed a staff-user
 * object, so bodies must never reach logs.
 */
export class TcvnJsonClient {
  private readonly baseOrigin: string;

  constructor(
    private readonly baseUrl: string = config.TCVN_BASE_URL,
    private readonly logger?: Pick<FastifyBaseLogger, 'warn'>
  ) {
    this.baseOrigin = new URL(this.baseUrl).origin;
  }

  /** Fetch and parse JSON from a URL on the TCVN base origin. */
  async getJson(url: URL): Promise<unknown> {
    if (url.origin !== this.baseOrigin) {
      throw new VsqiError(
        'TCVN client refused a URL outside the TCVN base origin',
        'INVALID_UPSTREAM_URL',
        502
      );
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= config.HTTP_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const startedAt = performance.now();
      const timeout = setTimeout(() => controller.abort(), config.HTTP_TIMEOUT_MS);

      try {
        const response = await this.fetchSameOrigin(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': config.HTTP_USER_AGENT,
            Accept: 'application/json'
          }
        });

        if (!response.ok) {
          throw new VsqiError(
            `TCVN returned HTTP ${response.status}`,
            'UPSTREAM_HTTP_ERROR',
            502
          );
        }

        try {
          return await response.json();
        } catch {
          throw new VsqiError(
            'TCVN did not return valid JSON',
            'INVALID_UPSTREAM_RESPONSE',
            502
          );
        }
      } catch (error) {
        lastError = error;
        if (error instanceof VsqiError) throw error;
        this.logger?.warn(
          {
            host: url.hostname,
            attempt: attempt + 1,
            elapsedMs: Math.round(performance.now() - startedAt),
            failureType: classifyUpstreamFailure(error),
            ...getErrorDetails(error)
          },
          'TCVN upstream request failed'
        );
        if (attempt < config.HTTP_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (classifyUpstreamFailure(lastError) === 'ETIMEDOUT') {
      throw new VsqiError('TCVN request timed out', 'UPSTREAM_TIMEOUT', 504, { cause: lastError });
    }
    throw new VsqiError('Unable to reach TCVN', 'UPSTREAM_UNAVAILABLE', 502, { cause: lastError });
  }

  /** GET following redirects only when the target stays on the base origin. */
  private async fetchSameOrigin(url: URL, options: RequestInit): Promise<Response> {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount++) {
      const response = await fetch(currentUrl, { ...options, redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location) return response;
      await response.body?.cancel();
      const next = new URL(location, currentUrl);
      if (next.origin !== this.baseOrigin) {
        throw new VsqiError(
          'TCVN returned a redirect outside the TCVN base origin',
          'UPSTREAM_REDIRECT_ERROR',
          502
        );
      }
      currentUrl = next;
    }
    throw new VsqiError('TCVN exceeded the redirect limit', 'UPSTREAM_REDIRECT_ERROR', 502);
  }
}
