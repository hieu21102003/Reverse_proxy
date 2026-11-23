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
      // VI/EN toggle + elib login via Documents view (screen 07 via elib backend)
      expect(page.body).toContain('lang-vi');
      expect(page.body).toContain('Đăng nhập tại mục Tài liệu');
      expect(page.body).toContain('header-login-btn');
      // Documents / elib integration (upload via /api/elib/* proxy)
      expect(page.body).toContain('data-view="documents"');
      expect(page.body).toContain('id="view-documents"');
      expect(page.body).toContain('Tài liệu thư viện');
      expect(page.body).toContain('elib-login-form');
      expect(page.body).toContain('elib-upload-form');
      expect(page.body).toContain('elib-session-list');
      expect(page.body).toContain('/api/elib/*');
      // UI enhancement: API docs view + API BASE URL removed
      expect(page.body).not.toContain('data-view="docs"');
      expect(page.body).not.toContain('id="view-docs"');
      expect(page.body).not.toContain('api-base-url');
      expect(page.body).not.toContain('API BASE URL');
      // UI enhancement: search tabs + file search
      expect(page.body).toContain('search-tab-btn-standards');
      expect(page.body).toContain('search-tab-btn-files');
      expect(page.body).toContain('file-search-query');
      expect(page.body).toContain('Tìm theo tiêu đề, mô tả, thẻ');
      expect(page.body).toContain('file-category-select');
      expect(page.body).toContain('file-load-more');
      // UI enhancement: header login/logout/upload hooks
      expect(page.body).toContain('header-upload-btn');
      expect(page.body).toContain('header-logout-btn');
      expect(page.body).toContain('header-user-info');
      expect(page.body).toContain('elib-dropzone');
      expect(page.body).toContain('nav-library-count');
      expect(page.body).toContain('hero-chips');
      expect(page.body).toContain('playground.css?v=8');
      expect(page.body).toContain('playground.js?v=8');
      // No fake mockup numbers may leak into the UI
      expect(page.body).not.toContain('12,480');
      expect(page.body).not.toContain('2.5 MB');

      const styles = await app.inject({ method: 'GET', url: '/playground.css' });
      expect(styles.statusCode).toBe(200);
      expect(styles.headers['content-type']).toContain('text/css');
      expect(styles.body).toContain('@media (max-width: 600px)');
      expect(styles.body).toContain('@keyframes shimmer');
      expect(styles.body).toContain('prefers-reduced-motion');
      expect(styles.body).toContain('#0b4f3a'); // Deep Green
      expect(styles.body).toContain('#c2410c'); // Terracotta
      expect(styles.body).toContain('.hero');
      expect(styles.body).toContain('.discipline-card');
      expect(styles.body).toContain('.result-card');
      expect(styles.body).toContain('.detail-hero');
      expect(styles.body).toContain('.detail-metadata-grid');
      expect(styles.body).toContain('.detail-timeline');
      expect(styles.body).toContain('.detail-source');
      expect(styles.body).toContain('.elib-card');
      expect(styles.body).toContain('.elib-progress-bar');
      expect(styles.body).toContain('.elib-session-row');
      expect(styles.body).toContain('.search-tabs');
      expect(styles.body).toContain('.file-card');
      expect(styles.body).toContain('.file-badge-pdf');
      expect(styles.body).not.toContain('.base-url-control');
      expect(styles.body).not.toContain('.docs-card');

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
      expect(script.body).toContain('loadDocumentsView');
      expect(script.body).toContain('/api/elib');
      expect(script.body).toContain('XMLHttpRequest');
      expect(script.body).toContain('DUPLICATE_FILE');
      // UI enhancement: no base-url machinery, same-origin relative calls
      expect(script.body).not.toContain('getBaseUrl');
      expect(script.body).not.toContain('apiBaseUrl');
      expect(script.body).not.toContain('vsqi-api-base-url');
      expect(script.body).not.toContain('navDocs');
      // UI enhancement: file search + shared auth + dropzone + library badge
      expect(script.body).toContain('searchFiles');
      expect(script.body).toContain('refreshElibAuth');
      expect(script.body).toContain('renderHeaderAuth');
      expect(script.body).toContain('updateDropzoneDisplay');
      expect(script.body).toContain('updateLibraryNavBadge');
      expect(script.body).toContain('/documents?limit=6');
      expect(script.body).toContain('Tìm theo tiêu đề, mô tả, thẻ');
      expect(script.body).toContain('Đăng nhập để tải');
      expect(script.body).toContain('__smartrailFileHelpers');
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
