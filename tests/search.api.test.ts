import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { StandardProvider } from '../src/types.js';

describe('search API regression', () => {
  it('keeps the existing search response shape unchanged', async () => {
    const result = {
      data: [{
        code: 'TCVN 9143:2022',
        name: 'Công trình thuỷ lợi',
        englishName: 'Hydraulic structures',
        year: 2022,
        status: 'Active',
        detailUrl: 'https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022',
        source: 'VSQI' as const
      }],
      pagination: { currentPage: 1, totalPages: 1, totalResults: 1 },
      source: 'VSQI' as const
    };
    const provider: StandardProvider = {
      search: async () => result,
      getDetail: async () => null
    };
    const app = await createApp(provider);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/standards/search?q=TCVN%209143&page=1'
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(result);
    } finally {
      await app.close();
    }
  });
});
