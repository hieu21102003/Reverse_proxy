import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';

const provider: StandardProvider = {
  search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'VSQI' }),
  getDetail: async () => null
};

describe('API playground static assets', () => {
  it('serves the playground, styles, and client script from Fastify', async () => {
    const app = await createApp(provider);
    try {
      const page = await app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.body).toContain('Search standards');
      expect(page.body).toContain('API base URL');
      expect(page.body).toContain('issuedDate');
      expect(page.body).toContain('Raw JSON');

      const styles = await app.inject({ method: 'GET', url: '/playground.css' });
      expect(styles.statusCode).toBe(200);
      expect(styles.headers['content-type']).toContain('text/css');
      expect(styles.body).toContain('@media (max-width: 600px)');

      const script = await app.inject({ method: 'GET', url: '/playground.js' });
      expect(script.statusCode).toBe(200);
      expect(script.headers['content-type']).toContain('javascript');
      expect(script.body).toContain('URLSearchParams');
      expect(script.body).toContain('Not provided by VSQI');
      expect(script.body).toContain('navigator.clipboard.writeText(result.raw)');
    } finally {
      await app.close();
    }
  });

  it('does not expose the temporary upstream diagnostics endpoint', async () => {
    const app = await createApp(provider);
    try {
      const response = await app.inject({ method: 'POST', url: '/internal/diagnostics/vsqi' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
    } finally {
      await app.close();
    }
  });
});
