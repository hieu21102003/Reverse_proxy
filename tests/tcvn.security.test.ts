import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { TcvnJsonClient } from '../src/http/tcvn-client.js';
import { mapTcvnDetail } from '../src/providers/tcvn.mapper.js';
import type { StandardDetail, StandardProvider } from '../src/types.js';

/**
 * Synthetic stand-in for what the live TCVN detail endpoint returns: the
 * real record embeds a staff-user object with a password hash. The values
 * below are invented for this test (nothing here came from the live API),
 * but the SHAPE is what the mapper must defend against.
 */
const POISONED_RECORD = {
  key: '39000c60-b330-11ed-a08f-d37f51aafcd9',
  di: 'TCVN 9143:2022',
  tn: 'Công trình thủy lợi',
  ti: 'Hydraulic structures',
  up: 'A',
  fm: '60',
  pi: '2022-12-21,2593/QĐ-BKHCN',
  rz: 'TCVN 9143:2012',
  ca: '93.160',
  vb: 'TCVN_9143_2022.PDF',
  fileUrl: 'https://files.example.invalid/TCVN_9143_2022.PDF',
  fileName: 'TCVN_9143_2022.PDF',
  updatedById: 7,
  updatedBy: {
    id: 7,
    username: 'staff-test-account',
    password: 'fake-password-hash-value',
    passwordHash: 'fake-password-hash-value',
    email: 'staff-test@example.invalid',
    role: 'STAFF'
  },
  vnuserin: 'staff-test-account',
  '@timestamp': '2021-02-03T04:25:32.665Z',
  an: 'internal note that must not leak',
  hb: 'internal holding note'
};

const FORBIDDEN = [
  'fake-password-hash-value',
  'password',
  'hash',
  'updatedBy',
  'vnuserin',
  'staff-test',
  'files.example.invalid',
  'TCVN_9143_2022.PDF',
  'internal note',
  '@timestamp'
];

describe('TCVN detail whitelisting', () => {
  it('never lets the staff-user object or any non-whitelisted field into a detail', () => {
    const detail = mapTcvnDetail(POISONED_RECORD, 'VN', 'http://tracuu.tcvn.vn/sdomain/front-api');
    expect(detail).not.toBeNull();
    const serialized = JSON.stringify(detail);
    for (const needle of FORBIDDEN) {
      expect(serialized).not.toContain(needle);
    }
    // The output shape is exactly the StandardDetail contract — no extra keys.
    expect(Object.keys(detail as StandardDetail).sort()).toEqual([
      'attributes',
      'code',
      'detailUrl',
      'effectiveDate',
      'englishName',
      'issuedDate',
      'issuingAgency',
      'name',
      'raw',
      'relations',
      'replacedBy',
      'replaces',
      'source',
      'status',
      'year'
    ]);
    expect(detail?.code).toBe('TCVN 9143:2022');
    expect(detail?.replaces).toBe('TCVN 9143:2012');
  });

  it('never exposes the poisoned record through the API', async () => {
    const detail = mapTcvnDetail(
      POISONED_RECORD,
      'VN',
      'http://tracuu.tcvn.vn/sdomain/front-api'
    ) as StandardDetail;
    const provider: StandardProvider = {
      search: async () => ({ data: [], pagination: { currentPage: 1 }, source: 'VSQI' }),
      getDetail: async () => detail
    };
    const app = await createApp(provider);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/standards/TCVN%209143%3A2022?source=TCVN_VN'
      });
      expect(response.statusCode).toBe(200);
      for (const needle of FORBIDDEN) {
        expect(response.body).not.toContain(needle);
      }
      expect(response.json().data.code).toBe('TCVN 9143:2022');
    } finally {
      await app.close();
    }
  });
});

describe('TcvnJsonClient origin allowlist', () => {
  it('refuses any URL outside the TCVN base origin', async () => {
    const client = new TcvnJsonClient('http://tracuu.tcvn.vn/sdomain/front-api');
    await expect(client.getJson(new URL('https://evil.example.invalid/x')))
      .rejects.toMatchObject({ code: 'INVALID_UPSTREAM_URL', statusCode: 502 });
    await expect(client.getJson(new URL('http://tracuu.tcvn.vn.evil.example.invalid/x')))
      .rejects.toMatchObject({ code: 'INVALID_UPSTREAM_URL', statusCode: 502 });
  });
});
