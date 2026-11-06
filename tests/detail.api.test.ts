import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { VsqiError } from '../src/errors.js';
import { HttpClient } from '../src/http/http-client.js';
import { VsqiProvider } from '../src/providers/vsqi.provider.js';
import { config } from '../src/config.js';
import type { StandardDetail, StandardProvider } from '../src/types.js';

const searchHtml = (code: string) => `<table id="list_tieu_chuan">
  <tr><td class="tc-item">
    <div><h4 class="text-blue"><a href="/tieuchuan/view?sohieu=${encodeURIComponent(code)}">${code}</a></h4>
      <p><b>Tiêu chuẩn thử nghiệm</b></p>
    </div>
  </td></tr>
</table>`;

const detailHtml = `<table><tr><td>
  <div class="col-md-2"><strong>Số hiệu</strong></div>
  <div class="col-md-2"><strong>TCVN 9143:2022</strong></div>
  <div class="col-md-2"><strong>Năm ban hành</strong> 2022</div>
  <div class="col-md-3"><strong>Tình trạng</strong> A - Còn hiệu lực (Active)</div>
</td></tr><tr><td>
  <div class="col-md-2"><strong>Tên tiếng Việt</strong></div>
  <div class="col-md-10">Tiêu chuẩn thử nghiệm</div>
</td></tr></table>`;

const detail: StandardDetail = {
  code: 'TCVN 9143:2022',
  name: 'Tiêu chuẩn thử nghiệm',
  englishName: null,
  year: 2022,
  status: 'Active',
  issuedDate: null,
  effectiveDate: null,
  issuingAgency: null,
  replacedBy: null,
  replaces: null,
  detailUrl: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022',
  source: 'VSQI'
};

function providerStub(overrides: Partial<StandardProvider> = {}): StandardProvider {
  return {
    search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'VSQI' }),
    getDetail: async () => detail,
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('detail API', () => {
  it('validates and normalizes the encoded standard code', async () => {
    const getDetail = vi.fn(async () => detail);
    const app = await createApp(providerStub({ getDetail }));
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/standards/tcvn%209143%3a2022' });
      expect(response.statusCode).toBe(200);
      expect(getDetail).toHaveBeenCalledWith('TCVN 9143:2022');
      expect(response.json()).toEqual({ data: detail });
    } finally {
      await app.close();
    }
  });

  it('caches successful search and detail responses using normalized keys', async () => {
    const search = vi.fn(async () => ({
      data: [],
      pagination: { currentPage: 1 },
      source: 'VSQI' as const
    }));
    const getDetail = vi.fn(async () => detail);
    const app = await createApp(providerStub({ search, getDetail }));

    try {
      for (const query of ['TCVN%209143', ' tcvn%20%209143 ']) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/standards/search?q=${query}&page=1`
        });
        expect(response.statusCode).toBe(200);
      }
      for (const code of ['TCVN%209143%3A2022', 'tcvn%209143%3a2022']) {
        const response = await app.inject({ method: 'GET', url: `/api/v1/standards/${code}` });
        expect(response.statusCode).toBe(200);
      }
      expect(search).toHaveBeenCalledTimes(1);
      expect(getDetail).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('coalesces concurrent requests for the same cache key', async () => {
    const search = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { data: [], pagination: { currentPage: 1 }, source: 'VSQI' as const };
    });
    const app = await createApp(providerStub({ search }));

    try {
      const responses = await Promise.all([
        app.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' }),
        app.inject({ method: 'GET', url: '/api/v1/standards/search?q=TCVN%209143&page=1' })
      ]);
      expect(responses.map(response => response.statusCode)).toEqual([200, 200]);
      expect(search).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('does not cache upstream errors', async () => {
    const search = vi.fn(async () => {
      throw new VsqiError('VSQI request timed out', 'UPSTREAM_TIMEOUT', 504);
    });
    const app = await createApp(providerStub({ search }));

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/standards/search?q=TCVN%209143&page=1'
        });
        expect(response.statusCode).toBe(504);
      }
      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('does not cache malformed provider responses or missing standards', async () => {
    const search = vi.fn()
      .mockResolvedValueOnce({ data: null } as never)
      .mockResolvedValue({ data: [], pagination: { currentPage: 1 }, source: 'VSQI' as const });
    const getDetail = vi.fn(async () => null);
    const app = await createApp(providerStub({ search, getDetail }));

    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const searchResponse = await app.inject({
          method: 'GET',
          url: '/api/v1/standards/search?q=TCVN%209143&page=1'
        });
        expect(searchResponse.statusCode).toBe(attempt === 0 ? 502 : 200);

        const detailResponse = await app.inject({
          method: 'GET',
          url: '/api/v1/standards/TCVN%209999%3A2099'
        });
        expect(detailResponse.statusCode).toBe(404);
      }
      expect(search).toHaveBeenCalledTimes(2);
      expect(getDetail).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('returns 400 for invalid standard codes', async () => {
    const app = await createApp(providerStub());
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/standards/anything' });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_CODE');
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the code is absent from VSQI search results', async () => {
    const provider = new VsqiProvider({
      getHtml: async () => '<html><body>No results<table id="list_tieu_chuan"></table></body></html>'
    });
    const app = await createApp(provider);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209999%3A2099' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('returns upstream timeout and failure errors without internal details', async () => {
    const cases = [
      { error: new VsqiError('VSQI request timed out', 'UPSTREAM_TIMEOUT', 504), status: 504 },
      { error: new VsqiError('VSQI returned HTTP 503', 'UPSTREAM_HTTP_ERROR', 502), status: 502 }
    ];

    for (const testCase of cases) {
      const app = await createApp(providerStub({ getDetail: async () => { throw testCase.error; } }));
      try {
        const response = await app.inject({ method: 'GET', url: '/api/v1/standards/TCVN%209143%3A2022' });
        expect(response.statusCode).toBe(testCase.status);
        expect(response.json().error.code).toBe(testCase.error.code);
        expect(response.body).not.toContain('stack');
      } finally {
        await app.close();
      }
    }
  });

  it('returns a consistent 429 response and does not limit health checks', async () => {
    const app = await createApp(providerStub());
    try {
      let limitedResponse;
      for (let attempt = 0; attempt <= config.RATE_LIMIT_MAX; attempt++) {
        limitedResponse = await app.inject({
          method: 'GET',
          url: '/api/v1/standards/search?q=TCVN%209143&page=1'
        });
      }
      expect(limitedResponse?.statusCode).toBe(429);
      expect(limitedResponse?.json()).toEqual({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests; please try again later'
        }
      });

      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('requests the detail URL with correctly encoded code using the shared HTTP client', async () => {
    const requestedUrls: string[] = [];
    const provider = new VsqiProvider({
      getHtml: async url => {
        requestedUrls.push(url.toString());
        return requestedUrls.length === 1 ? searchHtml('TCVN 9143:2022') : detailHtml;
      }
    });

    await expect(provider.getDetail('TCVN 9143:2022')).resolves.toMatchObject({ code: 'TCVN 9143:2022' });
    expect(requestedUrls).toEqual([
      'https://tieuchuan.vsqi.gov.vn/tim-kiem?k=TCVN+9143%3A2022&page=1',
      'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022'
    ]);
  });

  it('maps HTTP client timeouts to 504', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(new HttpClient().getHtml(new URL('https://tieuchuan.vsqi.gov.vn')))
      .rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', statusCode: 504 });
  });

  it('maps non-success upstream HTTP responses to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    await expect(new HttpClient().getHtml(new URL('https://tieuchuan.vsqi.gov.vn')))
      .rejects.toMatchObject({ code: 'UPSTREAM_HTTP_ERROR', statusCode: 502 });
  });
});
