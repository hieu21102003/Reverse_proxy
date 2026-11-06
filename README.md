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

- Node.js 22.15 or newer (`tls.getCACertificates('default')` is used to preserve the runtime's active trust store)
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
| `VSQI_TLS_SUPPLEMENTAL_CA` | `true` | Add the bundled VSQI intermediate only for HTTPS requests to `tieuchuan.vsqi.gov.vn:443`; set `false` after VSQI fixes its served chain |
| `HTTP_USER_AGENT` | `VSQI-Proxy-API/1.0` | Identify the service; configure a contact URL before production |
| `CACHE_TTL_SECONDS` | `300` | Successful-response cache lifetime; `0` disables storage |
| `CACHE_MAX_ENTRIES` | `1000` | Maximum in-memory cache entries; `0` disables storage |
| `RATE_LIMIT_MAX` | `30` | Requests per client IP per time window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window understood by `@fastify/rate-limit` |
| `TRUST_PROXY` | `false` | Trust forwarded client IP headers only behind a trusted proxy |
| `CORS_ORIGIN` | empty | Optional single allowed browser origin; empty disables CORS |

Configuration is validated at startup. `VSQI_BASE_URL` must use HTTPS. TLS certificate verification remains enabled. Do not commit `.env` or put credentials in the upstream URL.

### VSQI TLS chain workaround

VSQI currently serves its leaf certificate without the required intermediate. The API bundles the **GlobalSign GCC R3 DV TLS CA 2020** intermediate at `certs/globalsign-gcc-r3-dv-tls-ca-2020.der`; it is not downloaded at runtime. The certificate was retrieved from the issuer URL in the VSQI leaf certificate's Authority Information Access extension:

`http://secure.globalsign.com/cacert/gsgccr3dvtlsca2020.crt`

The DER asset is pinned by SHA-256 fingerprint `76:25:38:43:95:09:C4:11:C4:37:D3:C5:67:56:3E:13:78:67:12:81:FC:4A:14:64:AD:D0:31:87:08:43:67:6E` and expires **March 18, 2029**. Its issuer is GlobalSign Root CA - R3, already part of the Node trust store. The client combines this intermediate with Node's active default CA set and keeps `rejectUnauthorized: true` and normal hostname verification enabled.

The supplemental CA is used only by the Undici dispatcher for HTTPS connections to the exact host `tieuchuan.vsqi.gov.vn` on port 443. Redirects are handled individually: other hosts use ordinary `fetch` without this dispatcher, and the scoped dispatcher itself refuses other origins. `VSQI_TLS_SUPPLEMENTAL_CA=false` disables the workaround without changing the rest of the HTTP client. If the certificate expires or VSQI rotates its issuer, verify the new chain and issuer through a trusted source, update the asset and pinned fingerprint, and add/refresh the chain tests before redeploying.

**Removal after the upstream chain is fixed:** first set `VSQI_TLS_SUPPLEMENTAL_CA=false` in production and verify live Search and Detail requests. Then remove the TLS dispatcher and certificate asset, the environment variable/configuration, its tests and documentation, and the direct `undici` dependency if no longer used. Do not remove the workaround until the upstream server serves a complete valid chain.

The Vercel runtime failure was confirmed as `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: VSQI served its leaf certificate without the GlobalSign GCC R3 DV TLS CA 2020 intermediate. The scoped supplemental-CA workaround above addresses this without disabling verification. Local connectivity through the compiled client and workaround succeeded; no Vercel deployment has been tested after the change, so production resolution is not claimed.

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
