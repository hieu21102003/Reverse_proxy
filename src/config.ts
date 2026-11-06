import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3100),
  LOG_LEVEL: z.string().default('info'),
  VSQI_BASE_URL: z.string().url().refine(value => new URL(value).protocol === 'https:', {
    message: 'VSQI_BASE_URL must use HTTPS'
  }).default('https://tieuchuan.vsqi.gov.vn'),
  VSQI_SEARCH_PATH: z.string().default('/tim-kiem'),
  VSQI_DETAIL_PATH: z.string().default('/tieuchuan/view'),
  HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(10000),
  HTTP_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  VSQI_TLS_SUPPLEMENTAL_CA: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  HTTP_USER_AGENT: z.string().trim().min(1).default('VSQI-Proxy-API/1.0'),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(300),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(0).max(10000).default(1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  CORS_ORIGIN: z.string().trim().default('').refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.origin === value
        && (url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    } catch {
      return false;
    }
  }, { message: 'CORS_ORIGIN must be a single HTTPS origin (or localhost for development)' }),
  VSQI_ENABLED: z.string().default('true')
});

export const config = envSchema.parse(process.env);
