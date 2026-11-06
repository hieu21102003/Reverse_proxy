import { config } from '../config.js';
import { VsqiError } from '../errors.js';

export class HttpClient {
  async getHtml(url: URL): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.HTTP_MAX_RETRIES; attempt++) {
      const controller = new AbortController();
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
          throw new VsqiError(
            `VSQI returned HTTP ${response.status}`,
            'UPSTREAM_HTTP_ERROR',
            502
          );
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
          throw new VsqiError('VSQI did not return HTML', 'UNEXPECTED_CONTENT_TYPE', 502);
        }

        return await response.text();
      } catch (error) {
        lastError = error;
        if (error instanceof VsqiError) throw error;
        if (attempt < config.HTTP_MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    if (lastError instanceof Error && lastError.name === 'AbortError') {
      throw new VsqiError('VSQI request timed out', 'UPSTREAM_TIMEOUT', 504);
    }
    throw new VsqiError('Unable to reach VSQI', 'UPSTREAM_UNAVAILABLE', 502);
  }
}
