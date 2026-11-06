# VSQI Proxy API

A standalone Node.js, TypeScript, and Fastify service that retrieves public standard metadata from VSQI on demand. It does not mirror the VSQI database or fetch full standards documents.

The detail URL and metadata fields have been checked against a live VSQI detail page. Search and detail HTML can change; confirm VSQI's terms, request frequency, and reuse permissions before deployment.

## Architecture

```text
Fastify routes
  -> input validation and rate limiting
  -> CachedStandardProvider (bounded in-memory TTL cache + in-flight deduplication)
  -> VsqiProvider
  -> shared HttpClient (HTTPS, timeout, bounded retry)
  -> Cheerio search/detail parsers
```

The `StandardProvider` interface keeps the upstream integration replaceable. The cache and rate limiter are process-local; they do not require Redis or share state between replicas.

## Requirements and installation

- Node.js 20 or newer
- VSQI access permitted for your use case

```sh
npm ci
```

Copy `.env.example` to `.env` and adjust the environment values as needed. On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Environment configuration

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address |
| `PORT` | `3100` | Listen port |
| `LOG_LEVEL` | `info` | Pino log level |
| `VSQI_BASE_URL` | `https://tieuchuan.vsqi.gov.vn` | HTTPS-only upstream base URL |
| `VSQI_SEARCH_PATH` | `/tim-kiem` | VSQI search path |
| `VSQI_DETAIL_PATH` | `/tieuchuan/view` | VSQI detail path |
| `VSQI_ENABLED` | `true` | Set to `false` to disable upstream calls |
| `HTTP_TIMEOUT_MS` | `10000` | Upstream timeout, 100–120000 ms |
| `HTTP_MAX_RETRIES` | `1` | Bounded retries for network failures, 0–3 |
| `HTTP_USER_AGENT` | `VSQI-Proxy-API/1.0` | Identify the service; configure a contact URL before production |
| `CACHE_TTL_SECONDS` | `300` | Successful-response cache lifetime; `0` disables storage |
| `CACHE_MAX_ENTRIES` | `1000` | Maximum in-memory cache entries; `0` disables storage |
| `RATE_LIMIT_MAX` | `30` | Requests per client IP per time window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window understood by `@fastify/rate-limit` |
| `TRUST_PROXY` | `false` | Trust forwarded client IP headers only behind a trusted proxy |
| `CORS_ORIGIN` | empty | Optional single allowed browser origin; empty disables CORS |
| `VSQI_DIAGNOSTICS_TOKEN` | empty | Temporarily enables the protected `POST /internal/diagnostics/vsqi` endpoint; use a random token of at least 32 characters and remove it after diagnosis |

Configuration is validated at startup. `VSQI_BASE_URL` must use HTTPS. TLS certificate verification remains enabled. Do not commit `.env` or put credentials in the upstream URL.

### Temporary Vercel upstream diagnostics

The regular API logs each failed upstream attempt with the Node version, `NODE_OPTIONS`, error/cause name/message/code, failure classification, attempt number, elapsed time, and upstream host only. Request paths, query strings, authorization values, cookies, and upstream HTML are not included. The API's public error response remains unchanged.

To test the actual Function runtime, temporarily set `VSQI_DIAGNOSTICS_TOKEN` in Vercel Production Environment Variables to a randomly generated secret with at least 32 characters, redeploy, then call:

```sh
curl -X POST \
  -H "Authorization: Bearer $VSQI_DIAGNOSTICS_TOKEN" \
  https://YOUR_DEPLOYMENT_HOST/internal/diagnostics/vsqi
```

The endpoint is not registered when the token is unset, returns 404 for invalid credentials, and is limited to two calls per minute. It reports DNS lookup results and performs one HTTPS GET to `/tim-kiem?k=TCVN%209143`, returning status, content type, elapsed time, runtime version, and sanitized error details; it never returns the upstream HTML. Remove `VSQI_DIAGNOSTICS_TOKEN` after collecting the result and redeploy to remove the diagnostic route.

The project currently declares `engines.node` as `>=20`, not specifically Node 24. Vercel's supported-version mapping may therefore select a newer major (currently Node 26); use the `process.version` from the Function log/diagnostic response as the runtime evidence. Node's `--use-system-ca` support is version-dependent, and on Linux it uses the Linux runtime's system CA set, not the Windows certificate store used by local development. This flag only changes CA trust: it cannot fix DNS resolution, connection resets/refusals, timeouts, or upstream IP blocking. Certificate verification remains enabled in all cases.

Local connectivity was checked with Node `v24.22.0`: DNS resolved `tieuchuan.vsqi.gov.vn` to `210.245.108.206`; without `--use-system-ca`, HTTPS failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`; with `NODE_OPTIONS=--use-system-ca`, the requested search page returned HTTP 200 and `text/html`. This establishes a local CA-store difference, but does **not** establish the Vercel failure's cause. No Vercel runtime log or diagnostic response has been available to inspect yet.

## Local development and production build

```sh
npm run dev
npm test
npm run build
npm start
```

`npm start` runs the compiled `dist/server.js`; it does not start the development watcher. The server closes gracefully on `SIGINT` and `SIGTERM`.

Open `http://localhost:3100/` for the browser-based API playground. The API base URL field defaults to the current origin and can be changed to another service origin. For a separate frontend/API origin, configure `CORS_ORIGIN` on the API server to match the playground origin.

Health check:

```sh
curl http://localhost:3100/health
```

## Docker deployment

Build and run the multi-stage production image:

```sh
docker build -t vsqi-proxy-api .
docker run --rm --env-file .env -p 3100:3100 vsqi-proxy-api
```

The runtime image contains the compiled application and production dependencies only, runs as the non-root `node` user, and includes a `/health` container health check. Set `PORT` to `3100` in the container (or adjust the port mapping and health check if you change it). `.dockerignore` excludes local dependencies, build output, tests, and environment files.

## Vercel deployment

The Vercel configuration explicitly builds one Node.js Function from `src/vercel.ts` and routes requests to it. Vercel's automatic Fastify entrypoint detection recognizes filenames such as `src/app.ts`, `src/index.ts`, and `src/server.ts`, but not `src/vercel.ts`. Since `src/server.ts` remains the local development entrypoint and `src/app.ts` is the application factory, the project uses Vercel's explicit `@vercel/node` builder for the single `src/vercel.ts` Function instead of automatic Fastify detection. This also avoids treating `src/app.ts` as a Function entrypoint. The adapter creates one Fastify app, waits for it to be ready, exports a default Node.js request handler, and does not call `listen()`. Playground assets are included through that builder's `includeFiles` option. Local development continues to use `src/server.ts`.

1. Import the repository in Vercel with the repository root as the **Root Directory**. Keep the project **Framework Preset** set to **Other** so Vercel uses the explicit `builds` configuration in `vercel.json`.
2. Set the required environment variables in **Project Settings → Environment Variables**. Configure `VSQI_BASE_URL` as HTTPS; TLS verification stays enabled. `HOST` and `PORT` are only used by the local server.
3. Use Vercel CLI 48.6.0 or newer. From the repository root, link the project and deploy:

   ```sh
   npx vercel@latest link
   npx vercel@latest
   npx vercel@latest --prod
   ```

   Or connect the repository to Vercel for Git-based preview and production deployments.

The configuration emits only `src/vercel.ts` as a Function; `src/app.ts` remains an imported factory, not a separate Function. The Function serves `/`, `/playground.css`, `/playground.js`, `/health`, and the existing `/api/v1/standards/...` routes through the same Fastify instance. The `public/**` assets are included in its bundle. Vercel supplies the runtime port; do not start a second listener. In-memory cache and rate-limit state is per Function instance, as it is per process in other deployments.

## API

### `GET /api/v1/standards/search`

Searches VSQI. Query parameters:

| Name | Required | Constraints | Description |
|---|---:|---|---|
| `q` | yes | 2–120 characters | Search text |
| `page` | no | integer 1–1000; default `1` | Result page |

Example:

```sh
curl "http://localhost:3100/api/v1/standards/search?q=TCVN%209143&page=1"
```

Success response:

```json
{
  "data": [
    {
      "code": "TCVN 9143:2022",
      "name": "Công trình thuỷ lợi - Tính toán thiết kế thấm dưới đáy và vai công trình trên nền không phải là đá",
      "englishName": "Hydraulic structures - Seepage analysis through non-rock foundation and around abutments of hydraulic structures",
      "year": 2022,
      "status": "Active",
      "detailUrl": "https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022",
      "source": "VSQI"
    }
  ],
  "pagination": { "currentPage": 1, "totalPages": 1, "totalResults": 2 },
  "source": "VSQI"
}
```

### `GET /api/v1/standards/:code`

Looks up an exact code and returns detail metadata. Encode spaces and reserved characters in the path:

```sh
curl "http://localhost:3100/api/v1/standards/TCVN%209143%3A2022"
```

Success response:

```json
{
  "data": {
    "code": "TCVN 9143:2022",
    "name": "Công trình thuỷ lợi - Tính toán thiết kế thấm dưới đáy và vai công trình trên nền không phải là đá",
    "englishName": "Hydraulic structures - Seepage analysis through non-rock foundation and around abutments of hydraulic structures",
    "year": 2022,
    "status": "Active",
    "issuedDate": null,
    "effectiveDate": null,
    "issuingAgency": null,
    "replacedBy": null,
    "replaces": "TCVN 9143:2012",
    "detailUrl": "https://tieuchuan.vsqi.gov.vn/tieuchuan/view?sohieu=TCVN+9143%3A2022",
    "source": "VSQI"
  }
}
```

Detail fields are present as `null` when not found in the detail page. The API does not infer dates or an issuing agency from other fields.

### Errors

Validation errors return `400`; missing standards return `404`; upstream failures return `502`; upstream timeouts return `504`; rate limits return `429`. Error responses do not include upstream HTML or stack traces.

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "VSQI request timed out"
  },
  "source": "VSQI"
}
```

Other error codes include `INVALID_QUERY`, `INVALID_CODE`, `NOT_FOUND`, `UPSTREAM_HTTP_ERROR`, `UPSTREAM_UNAVAILABLE`, `INVALID_UPSTREAM_HTML`, and `RATE_LIMIT_EXCEEDED`. Validation and rate-limit errors omit `source` because they are not upstream errors.

### Cache and rate limits

- Successful search results and non-null detail responses are cached in memory by normalized query/page or standard code.
- The TTL and entry limit are configurable. Failed, malformed, and not-found responses are not stored.
- Concurrent requests with the same cache key share one in-flight request.
- `429` responses use `{"error":{"code":"RATE_LIMIT_EXCEEDED","message":"Too many requests; please try again later"}}`.
- Rate limiting applies to the public API routes, not `/health`.
- Both cache and rate-limit state are local to each process; multi-replica deployments have per-replica limits and caches.
- If deployed behind a reverse proxy, enable `TRUST_PROXY=true` only when direct public access is blocked and forwarded headers are set by a trusted proxy.

### JavaScript integration

```js
const code = 'TCVN 9143:2022';
const response = await fetch(
  `https://api.example.com/api/v1/standards/${encodeURIComponent(code)}`
);

if (!response.ok) {
  const error = await response.json();
  throw new Error(`${error.error.code}: ${error.error.message}`);
}

const { data: standard } = await response.json();
console.log(standard.name, standard.status);
```

## Automated and manual integration checks

```sh
npm test
```

Tests use local fixtures and mocked providers/HTTP responses; they do not depend on VSQI availability. To manually test a running local API against the live provider:

```sh
node scripts/live-test.mjs "TCVN 9143:2022"
```

Set `API_BASE_URL` to use another running API instance. Search/detail selectors should be rechecked if VSQI changes its HTML. Do not bypass login, CAPTCHA, access controls, or upstream rate limits, and do not fetch or redistribute full standard documents.
