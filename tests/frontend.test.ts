import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';

const provider: StandardProvider = {
  search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'MULTI' }),
  getDetail: async () => null
};

describe('Smart.Rail Digital Library static assets', () => {
  it('serves the Smart.Rail UI, styles, and client script from Fastify', async () => {
    const app = await createApp(provider);
    try {
      const page = await app.inject({ method: 'GET', url: '/' });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      // Branding + Home (screen 01)
      expect(page.body).toContain('Smart.Rail');
      expect(page.body).toContain('DIGITAL LIBRARY');
      expect(page.body).toContain('Thư viện tri thức Đường sắt');
      expect(page.body).toContain('hero-search-form');
      expect(page.body).toContain('Danh mục chuyên ngành');
      expect(page.body).toContain('Tài liệu mới cập nhật');
      expect(page.body).toContain('Bộ sưu tập nổi bật');
      // Search (screen 02)
      expect(page.body).toContain('Tìm kiếm tài liệu');
      expect(page.body).toContain('Bộ lọc kết quả');
      expect(page.body).toContain('Tìm kiếm nâng cao');
      expect(page.body).toContain('Raw JSON');
      // Categories (screen 03) + My Library (screen 06)
      expect(page.body).toContain('categories-grid');
      expect(page.body).toContain('Thư viện cá nhân');
      expect(page.body).toContain('library-favorites');
      // Detail (screen 04) keeps the view-model sections
      expect(page.body).toContain('detail-metadata-grid');
      expect(page.body).toContain('detail-source');
      expect(page.body).toContain('Thông tin khác');
      expect(page.body).toContain('issuedDate');
      // VI/EN toggle + honest login state (screen 07 has no backend)
      expect(page.body).toContain('lang-vi');
      expect(page.body).toContain('Chưa có backend đăng nhập');
      // No fake mockup numbers may leak into the UI
      expect(page.body).not.toContain('12,480');
      expect(page.body).not.toContain('2.5 MB');

      const styles = await app.inject({ method: 'GET', url: '/playground.css' });
      expect(styles.statusCode).toBe(200);
      expect(styles.headers['content-type']).toContain('text/css');
      expect(styles.body).toContain('@media (max-width: 600px)');
      expect(styles.body).toContain('#0b4f3a'); // Deep Green
      expect(styles.body).toContain('#c2410c'); // Terracotta
      expect(styles.body).toContain('.hero');
      expect(styles.body).toContain('.discipline-card');
      expect(styles.body).toContain('.result-card');
      expect(styles.body).toContain('.detail-hero');
      expect(styles.body).toContain('.detail-metadata-grid');
      expect(styles.body).toContain('.detail-timeline');
      expect(styles.body).toContain('.detail-source');

      const script = await app.inject({ method: 'GET', url: '/playground.js' });
      expect(script.statusCode).toBe(200);
      expect(script.headers['content-type']).toContain('javascript');
      expect(script.body).toContain('URLSearchParams');
      expect(script.body).toContain('navigator.clipboard.writeText(result.raw)');
      expect(script.body).toContain('buildDetailViewModel');
      expect(script.body).toContain('__vsqiDetailModel');
      expect(script.body).toContain('detail-status-badge');
      expect(script.body).toContain('partialFailures');
      expect(script.body).toContain('smartrail-favorites');
      expect(script.body).toContain('smartrail-recent');
      expect(script.body).toContain('applyLanguage');
      expect(script.body).not.toContain('12480');
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
