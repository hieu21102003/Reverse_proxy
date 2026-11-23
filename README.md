# VSQI Proxy API

A standalone Node.js, TypeScript, and Fastify service that retrieves public standard metadata on demand from three sources and returns one merged list: VSQI (`tieuchuan.vsqi.gov.vn`, scraped HTML) and tracuu.tcvn.vn (Vietnamese and international standards, JSON API). It does not mirror any upstream database or fetch full standards documents.

The detail URL and metadata fields have been checked against a live VSQI detail page. Search and detail HTML can change; confirm VSQI's terms, request frequency, and reuse permissions before deployment.

## Architecture

```text
Fastify routes
  -> input validation and rate limiting
  -> CachedStandardProvider (bounded in-memory TTL cache + in-flight deduplication)
  -> MergedStandardProvider (Promise.allSettled fan-out, partial-failure tolerant)
       -> VsqiProvider -> shared HttpClient (HTTPS, timeout, bounded retry)
       -> Cheerio search/detail parsers
       -> TcvnVnProvider -> TcvnJsonClient (HTTP, TCVN origin only)
       -> TcvnQtProvider -> TcvnJsonClient (HTTP, TCVN origin only)
```

The `StandardProvider` interface keeps each upstream integration replaceable. The cache and rate limiter are process-local; they do not require Redis or share state between replicas.

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
| `TCVN_BASE_URL` | `http://tracuu.tcvn.vn/sdomain/front-api` | TCVN JSON API base URL (HTTP-only; the host resets HTTPS). Must stay on `tracuu.tcvn.vn` |
| `TCVN_ENABLED` | `true` | Set to `false` to disable TCVN calls |
| `TCVN_SEARCH_LIMIT` | `20` | Records per TCVN search call (per title field / per organisation), 1–100 |
| `TCVN_QT_MAX_ORGS` | `11` | Max organisations fanned out to for an international title query, 1–20 |
| `TCVN_ORG_LIST_TTL_SECONDS` | `3600` | How long the fetched international organisation list is cached; `0` refetches every time |
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
| `ELIB_BASE_URL` | `http://127.0.0.1:3200` | Elib document service base URL for the `/api/elib/*` proxy (see Elib integration). In Docker, `127.0.0.1` is the container itself — use the shared `elib-net` network (`http://elib-service:3200`, see `.env.server.example`) or run bare-Node |
| `ELIB_ENABLED` | `true` | Set to `false` to disable the elib proxy (`/api/elib/*` returns 503, Tài liệu view shows a disabled state) |
| `ELIB_TIMEOUT_MS` | `300000` | Elib proxy timeout for uploads/downloads, 5000–3600000 ms (generous on purpose; not the 10 s VSQI timeout) |
| `STANDARDS_DB_ENABLED` | `false` | Enable the standards metadata DB integration (elib `/internal/standards/*`); off = live-proxy behavior unchanged |
| `STANDARDS_INTERNAL_TOKEN` | empty | Shared secret for elib internal API calls (same value on elib); never logged |
| `STANDARDS_DB_TIMEOUT_MS` | `2000` | Timeout for internal DB calls, 100–30000 ms (short on purpose; DB errors never fail search) |
| `STANDARDS_STALE_DAYS` | `7` | Freshness window in days for the stale-data warning on DB-fallback details; `0` = always stale |

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

Open `http://localhost:3100/` for the Smart.Rail Digital Library web UI. The API base URL field (header) defaults to the current origin and can be changed to another service origin. For a separate frontend/API origin, configure `CORS_ORIGIN` on the API server to match the UI origin.

## Web UI (Smart.Rail Digital Library)

The browser UI at `/` follows the Smart.Rail Digital Library Phase 1 UI specification (Deep Green + Terracotta, Be Vietnam Pro / Inter, VI/EN toggle, desktop-first responsive). Standards screens are a thin client over the merged-search API; the **Tài liệu** view talks to the separate elib service through the `/api/elib/*` proxy (see Elib integration below). The static assets keep their historical filenames (`public/index.html`, `public/playground.css`, `public/playground.js`) so the Fastify routes and `vercel.json` are unchanged.

| Spec screen | Status | Notes |
| --- | --- | --- |
| 01 Library Home | Implemented | Hero search, 6 discipline cards, "Tài liệu mới cập nhật" loaded live from the search API (sorted by year desc), featured collections as labelled search shortcuts. No hard-coded counts or dates. |
| 02 Document Search | Implemented | One merged list from VSQI + TCVN_VN + TCVN_QT with per-item `source`, per-source totals from `sources[]`, `partialFailures` banner, shareable `?view=search&q=&page=` URLs, Raw JSON toggle. Filters (source/year/status), sort (relevance/newest/title) and list/grid are **client-side** on the returned page — the API only accepts `q` + `page`, and paging is over the merged list (20 per page, sources over-fetched). |
| 03 Document Categories | Implemented (as search topics) | CAT01–CAT06 cards with subcategory shortcuts. Counts are live `totalResults` per category keyword (or "—"/unavailable on failure); there is no taxonomy backend, so each category is a topic search. |
| 04 Document Detail | Implemented | Breadcrumb, CSS-generated cover (organisation + code), badges, metadata rows (`issuingAgency`, dates, year, status, source — "—" when null, e.g. TCVN issuing agency), scope/related/history/other sections via the existing `buildDetailViewModel`, "Xem tại nguồn gốc" (`detailUrl`, new tab), save to My Library, copy `?view=detail&code=&source=` link. No Download button: the API serves metadata only, there is no file. |
| 05 Online Viewer | Partial (metadata preview) | "Xem trước thông tin" opens a modal summarizing the record with a link to the source. There is no PDF preview, thumbnails, or zoom — the API has no document files. |
| 06 My Library | Implemented (client-side) | Favorites + recently viewed in `localStorage` (`smartrail-favorites`, `smartrail-recent`). Not synced per account. |
| 07 Login & Profile | Implemented via elib (Documents view) | Sign-in happens in the **Tài liệu** view against the elib service (`/api/elib/auth/*` through the proxy). There is no registration page; accounts are created by the library admin (elib `create-admin` script). Profile editing is not implemented. |
| 08–10 Admin (Dashboard / Document Management / Metadata & Access) | Partial (upload only) | The **Tài liệu** view provides elib Phase 1 upload (single file + metadata, progress, duplicate handling) for admin/editor accounts. Dashboards, document list/management, and metadata/access admin are **not** implemented — elib has no list/management API yet (Phase 4). Nothing is faked. |

Language: VI by default; the VI/EN toggle switches all UI chrome labels via a dictionary (document titles use the API's `name`/`englishName` as-is). Fonts load from Google Fonts (allowed by the Helmet CSP `style-src https:` / `font-src https:`) with a system font-stack fallback. The API reference view documents the merged response (`source: "MULTI"`, `sources[]`, `partialFailures`), `?source=` detail pinning, and the accepted code organisations (TCVN/QCVN/TCXD/TCN/TCCS/ISO/IEC/ASTM/BS/DIN/EN/JIS/UL/ANSI/AS/GB/GOST/ST SEV).

Health check:

```sh
curl http://localhost:3100/health
```

## Elib integration (Tài liệu)

The **Tài liệu** view integrates the separate **elib** document service (Fastify + TypeScript + PostgreSQL, Phase 1: single-file upload with metadata, magic-byte validation, SHA-256 dedup, permission-checked download). Elib is a different codebase/service with its own database and on-disk storage; Reverse_proxy holds **no** documents, users, or files — it only proxies.

```
Browser ──> nginx (HTTPS) ──> Reverse_proxy :3100 ──/api/elib/*──> elib :3200 (internal only)
                                   └──/api/v1/*──> VSQI + tracuu.tcvn.vn
```

- Proxy: all methods on `/api/elib/*` are forwarded to `{ELIB_BASE_URL}/api/*` (query preserved) with **streaming** request/response bodies (undici `request()` + `reply.hijack()`, see `src/elib-proxy.ts`) — 200 MB uploads and downloads are never buffered in memory. `Cookie` is forwarded and every `Set-Cookie` is passed through, so elib's httpOnly session cookie (`path=/`) works same-origin. Elib unreachable → `502 ELIB_UNAVAILABLE` (Vietnamese JSON); `ELIB_ENABLED=false` → `503 ELIB_DISABLED`. Standards search keeps working either way. Proxy routes are exempt from the standards rate limit (a 30/min cap would break large transfers); elib enforces auth and file-size limits itself.
- UI flow: opening **Tài liệu** calls `GET /api/elib/auth/me`. Signed out → login form (`POST /api/elib/auth/login`). Viewer role → "Bạn không có quyền upload". Admin/editor → upload form (file, title, description, category from `GET /api/elib/categories`, doc_type, language, tags, visibility, status) sent with `XMLHttpRequest` for real progress; `409 DUPLICATE_FILE` offers "Bỏ qua / Vẫn tạo mới" (resubmit with `force=true`). Successful uploads appear in a session-only list with download links (`GET /api/elib/documents/:id/files/:fileId/download`). There is **no document list** yet — elib Phase 1 has no list/search endpoint; browsing/management is Phase 4. The UI says so instead of faking a list.
- Same-origin requirement: the session cookie only flows when the UI and `/api/elib/*` share an origin (the normal nginx setup). If the header **API BASE URL** points at a different origin, elib login will not persist without CORS credentials — keep the default (current origin) for elib use.
- Deploying elib: run it separately on the same server, bound to `127.0.0.1:3200` (never public), with its own PostgreSQL and `STORAGE_ROOT`. Steps (from the elib-service README): `npm install` → fill `.env` (`DATABASE_URL`, `STORAGE_ROOT`, `SESSION_SECRET`, `COOKIE_SECURE=true` behind HTTPS, `PORT=3200`) → `npm run migrate` → `npm run seed:categories` → `npm run create-admin` → `npm run build && npm start`. When both run in Docker, they share the fixed-name network `elib-net` (declared in this repo's `docker-compose.yml`; elib's compose joins it as an external network) and Reverse_proxy uses `ELIB_BASE_URL=http://elib-service:3200` (elib's container name) — the old `host.docker.internal` route cannot work because elib only binds host loopback. Start elib before or after Reverse_proxy — the proxy tolerates elib being down (502 banner in the Tài liệu view only). Full runbook: [docs/deploy-server.md](docs/deploy-server.md).
- Proxy hardening: `/api/elib/*` only forwards an **allowlist** of elib API paths (`auth/login|logout|me`, `categories`, `documents`, `documents/:id/files/:fileId/download`); other paths get `404 ELIB_ROUTE_NOT_FOUND`, traversal attempts (`../`, `%2e%2e`, `%2f`) get `400 ELIB_BAD_PATH`, and a client-sent `X-Internal-Token` header is always stripped (it is the shared secret for elib's internal API and must never be injectable from a browser).

## Standards metadata DB (Bước 1, optional)

With `STANDARDS_DB_ENABLED=true` (+ the same `STANDARDS_INTERNAL_TOKEN` on elib, which must have run migration 003), Reverse_proxy also talks to elib's **internal** metadata API (`/internal/standards/lookup` + `/ingest`, reachable only on `elib-net`, never through the browser proxy). The DB is fed gradually from real searches/details — no crawling.

Order of layers for search/detail:

1. **In-memory response cache** (`CACHE_TTL_SECONDS`, default 300s) — a hit short-circuits everything below.
2. **Live upstream** (VSQI + TCVN) — always consulted first for detail; search always runs live and merges DB editions into the page (dedup by light-normalized code, live fields win, DB adds `lastVerifiedAt`/`fromDb`; editions with no live counterpart are added as DB-only items).
3. **Metadata DB** — for detail it is **only a fallback**: consulted when live fails (upstream error or not found) and served with `dbInfo.servedFrom='db'` so the UI labels it "Dữ liệu từ DB, có thể chưa đầy đủ". DB-first serving was removed 2026-11-23; `STANDARDS_STALE_DAYS` now only drives the stale-data warning. Revisit DB priority only once lookup payloads are complete.

Live results are ingested back fire-and-forget as **one multi-source request per results page** (one `search_log` row per search; `raw` is never sent). The wire shapes are the shared zod contract (`src/standards-db/contract.ts`, mirrored from elib — elib is the source of truth; contract tests in both repos validate the same JSON fixture). Internal calls use a short timeout (`STANDARDS_DB_TIMEOUT_MS`, default 2000ms) behind a circuit breaker (5 consecutive failures → 60s pause); any DB error is logged and swallowed — search/detail never fail because of the DB. Detail responses carry `dbInfo` (`servedFrom`, `lastVerifiedAt`, `stale`, `staleDays`, `sources`) so the UI can show "Kiểm tra lần cuối", label DB-served data, and warn when the record is past the freshness threshold. The UI never links the TCVN front-api JSON `detailUrl` as a public source page; it shows fallback links instead (VSQI page when a VSQI snapshot exists, ISO OBP search, Google search). With the flag off (default), behavior is identical to the live-proxy-only service.

**Not yet verified:** the real elib + PostgreSQL integration run and real-browser rendering. Run `tests/standards-db.live.test.ts` against a dev elib+Postgres per [docs/standards-db-live-test.md](docs/standards-db-live-test.md) before enabling `STANDARDS_DB_ENABLED`.

## Docker deployment

Build and run the multi-stage production image:

```sh
docker build -t vsqi-proxy-api .
docker run --rm --env-file .env -p 3100:3100 vsqi-proxy-api
```

The runtime image contains the compiled application and production dependencies only, runs as the non-root `node` user, and includes a `/health` container health check. Set `PORT` to `3100` in the container (or adjust the port mapping and health check if you change it). `.dockerignore` excludes local dependencies, build output, tests, and environment files.

## Server operations: TLS certificate reload & backup schedule

### Isolated HTTPS (Caddy `:8443`) & TLS certificate reload

When deployed alongside `esign` on the same host, `Reverse_proxy` runs completely independently (own Docker networks `reverse_proxy_default` + `elib-net`, own volumes, own `Caddyfile` and `docker-compose.override.yml`) and never touches any `esign-*` container, network, or volume. Until `Reverse_proxy` has its own dedicated certificate, its Caddy container listens on `:8443` and bind-mounts **only the two individual certificate/key files** read-only (`:ro`):

- `/opt/esign-app/esign/pki-data/server/server.crt` → `/etc/caddy/certs/server.crt:ro`
- `/opt/esign-app/esign/pki-data/server/server.key` → `/etc/caddy/certs/server.key:ro`

> **Single-file bind-mount inode caveat:** Docker bind-mounts individual files by **inode**. When `esign` renews its certificate by atomic file replacement (`mv new.crt server.crt`), the host path gets a new inode while the running Caddy container still holds the old inode — so running `caddy reload` alone will keep serving the old certificate.

Whenever `esign` renews `/opt/esign-app/esign/pki-data/server/server.crt` and `server.key`, recreate **only** `reverse-proxy-caddy` to pick up the new inodes (zero impact on `esign-*` or `reverse-proxy`):

```sh
cd /opt/Reverse_proxy
docker compose up -d --force-recreate caddy
```

Verify the served certificate and full TLS chain against the internal Root CA:

```sh
# Check certificate dates, subject, and issuer actually served on :8443
openssl s_client -connect 192.168.1.66:8443 -servername 192.168.1.66 </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer

# Verify TLS validation and health endpoint without -k
curl --cacert /opt/esign-app/esign/pki-data/public/root.crt -fsS https://192.168.1.66:8443/health
```

The current server certificate expires on **Nov 17, 2027 (`2027-11-17 GMT`)** — set an operational reminder 30 days beforehand to verify renewal and recreate `reverse-proxy-caddy`.

### Backup schedule (`pg_dump` + `STORAGE_ROOT`)

When deploying **PostgreSQL + Elib** (Phase 2), place both the PostgreSQL data directory (`/srv/elib/pgdata`) and `STORAGE_ROOT` (`/srv/elib/storage`) on explicit **host bind mounts backed by the large storage partition** (never inside container writable layers or ephemeral volumes). Store local backups under `/srv/elib/backups` and also replicate them off-host (external disk or NAS following the 3-2-1 rule).

| Target | Method | Schedule | Retention |
|---|---|---|---|
| PostgreSQL (Elib metadata/users) | `pg_dump -Fc` (compressed custom format) | Daily at `02:00` | 14 daily + 4 weekly (Sunday) + monthly |
| `STORAGE_ROOT` (`/srv/elib/storage`) | `rsync -a --delete` (plus weekly off-host sync) | Daily at `02:30` | Latest mirror + weekly off-host copy |
| Restore drill | `pg_restore` into a temporary DB + spot-check files in `/srv/elib/storage` | Quarterly | Verify checksum & readability |

Example backup and restore commands (matching the deployed `elib-postgres` container, user `elib`, and database `elib`):

```sh
# 1. Daily PostgreSQL logical dump (custom format)
docker exec -t elib-postgres pg_dump -U elib -Fc elib \
  > "/srv/elib/backups/db/elib_$(date +\%F).dump"

# Prune daily dumps older than 14 days (Sunday copies are preserved in backups/db/weekly/)
find /srv/elib/backups/db -maxdepth 1 -name 'elib_*.dump' -mtime +14 -delete

# 2. Daily STORAGE_ROOT incremental mirror
rsync -a --delete /srv/elib/storage/ /srv/elib/backups/storage/

# 3. Restore drill (verify dump into a temporary database without touching production)
docker exec -i elib-postgres createdb -U elib elib_restore_test
docker exec -i elib-postgres pg_restore -U elib -d elib_restore_test --no-owner \
  < /srv/elib/backups/db/elib_YYYY-MM-DD.dump
docker exec -i elib-postgres dropdb -U elib elib_restore_test
```

Example `crontab -e` entries (run DB dump before `STORAGE_ROOT` sync so metadata and file blobs stay closely aligned, and mirror `/srv/elib/backups` to off-host storage weekly):

```cron
0 2 * * * docker exec elib-postgres pg_dump -U elib -Fc elib > /srv/elib/backups/db/elib_$(date +\%F).dump && [ "$(date +\%u)" = "7" ] && cp /srv/elib/backups/db/elib_$(date +\%F).dump /srv/elib/backups/db/weekly/ || true
15 2 * * * find /srv/elib/backups/db -maxdepth 1 -name 'elib_*.dump' -mtime +14 -delete
30 2 * * * rsync -a --delete /srv/elib/storage/ /srv/elib/backups/storage/
```

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

### Merged search

One search call searches all three sources and returns one list. Each item
carries a `source` field: `VSQI`, `TCVN_VN` (Vietnamese standards from
tracuu.tcvn.vn), or `TCVN_QT` (international standards from tracuu.tcvn.vn).
The top-level `source` is `MULTI` for merged results.

- **Order:** VSQI first, then TCVN_VN, then TCVN_QT; each source's own
  order is preserved. The same code may legitimately appear in two sources
  and is kept once per source.
- **Paging:** paging is over the merged list, 20 items per page. Each
  source is over-fetched page by page (capped at 10 upstream pages per
  source) until it has contributed enough items or is exhausted, then the
  merged list is sliced — so pages have no gaps while any source still
  has records. `pagination.totalResults` is the sum of the per-source
  totals (per-source breakdown in `sources`) and is an **upper bound**:
  fanned-out totals (a TCVN title search, or an international title
  search across organisations) may double-count records listed under
  several fields/organisations, and the same standard can be counted by
  several sources. `pagination.totalPages` is
  `ceil(totalResults / 20)`, exact when every successful source was
  exhausted. The returned page itself is deduplicated by source + code.
- **Partial failure:** one source failing (or disabled via
  `VSQI_ENABLED`/`TCVN_ENABLED`) never fails the whole search. Its records
  are absent, it is listed in `partialFailures` and in `sources` with
  `ok: false`, and the failure is logged. Only when every source fails
  does search return `502`.
- **Detail:** `GET /api/v1/standards/:code` accepts TCVN, QCVN, TCXD, TCN,
  TCCS, ISO, IEC, ASTM, BS, DIN, EN, JIS, UL, ANSI, AS, GB, GOST and
  ST SEV codes, with or without a year, including parenthesised suffixes
  such as `ISO 9001:2015 (E)`. Without `?source=`, sources are tried in
  merge order (VSQI, then TCVN_VN, then TCVN_QT) and the first hit wins;
  `?source=VSQI|TCVN_VN|TCVN_QT` pins one source. An invalid `source`
  returns `400` (`INVALID_SOURCE`). TCVN detail lookups retry with
  `status=H` (withdrawn) when the effective-only search misses, so
  replaced standards (e.g. following "replaces TCVN 9143:2012") resolve
  instead of returning `404`; search itself stays effective-only.

### TCVN (tracuu.tcvn.vn)

The TCVN sources use the site's JSON front-api at
`http://tracuu.tcvn.vn/sdomain/front-api` — **HTTP only**; the host resets
HTTPS connections, so the client never uses HTTPS for it, and it refuses
any URL outside that exact origin (including redirects). No login is needed
for search/detail.

- Vietnamese: `GET /vs-standard/search?...` and `GET /vs-standard/<key>`.
- International: `GET /is-standard/search?...`,
  `GET /is-standard/<key>`, and `GET /is-standard/is-organization/all`
  for the organisation list.
- Search parameters are the site's form controls. `status=A` (still
  effective) is always sent — without it the backend returns zero results.
  Vietnamese searches use `di` (code), or `tn` (Vietnamese title) and `ti`
  (English title) as two parallel calls, because the backend ANDs
  parameters (sending `tn` and `ti` together returns nothing).
  International searches always send a real `orgCode`: a code query uses
  the organisation from its prefix (`ISO 9001` → `ISO`, `EN ISO 9001` →
  `EN`, `GB/T 19001` → `TCTQ/GB`); a title query fans out across the
  enabled organisations (`orgCode=ALL` is not a wildcard — it returns
  nothing). International title search uses `ti` only: the `tn` field on
  international records is a non-English title, never a Vietnamese name.
- Field mapping: `di` = code, `ti` = English title, `tn` = Vietnamese
  title (Vietnamese records only), `dp` = publication date
  (international), `pi` = issue date + decision (Vietnamese), `up` =
  `A` effective / `H` expired, `fm` = pages, `ca` = ICS codes
  (`*`-separated), `rz` = replaces, `rx` = replaced by, `ii` =
  equivalents. TCVN `detailUrl` values point at the front-api JSON record:
  the site has no public per-record HTML detail page in this integration.
- **Security:** TCVN detail responses embed a staff-user object
  (`updatedBy`) containing a password hash. The mapper whitelists only the
  fields listed above; the raw record is never stored, logged, or returned,
  and no file-download field (`vb`, `fileUrl`) is ever exposed. This
  service returns metadata only — it never downloads full standard
  documents.

### `GET /api/v1/standards/search`

Searches all three sources (see "Merged search"). Query parameters:

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
    },
    {
      "code": "TCVN 9143:2022",
      "name": "Công trình thủy lợi. Tính toán thấm dưới đáy và vai công trình trên nền không phải là đá",
      "englishName": "Hydraulic structures - Seepage analysis through non-rock foundation and around abutments of hydraulic structures",
      "year": 2022,
      "status": "Active",
      "detailUrl": "http://tracuu.tcvn.vn/sdomain/front-api/vs-standard/39000c60-b330-11ed-a08f-d37f51aafcd9",
      "source": "TCVN_VN"
    }
  ],
  "pagination": { "currentPage": 1, "totalResults": 3, "totalPages": 1 },
  "source": "MULTI",
  "sources": [
    { "source": "VSQI", "ok": true, "totalResults": 2, "totalPages": 1 },
    { "source": "TCVN_VN", "ok": true, "totalResults": 1, "totalPages": 1 },
    { "source": "TCVN_QT", "ok": true, "totalResults": 0 }
  ]
}
```

The same code can appear twice with different `source` values — that is
one record per source, not a duplicate. `pagination.totalPages` counts
merged pages of 20 (see "Merged search"); `sources[].totalPages` remains
the per-source page count at that source's own page size.

### `GET /api/v1/standards/:code`

Looks up an exact code and returns detail metadata. Encode spaces and reserved characters in the path:

```sh
curl "http://localhost:3100/api/v1/standards/TCVN%209143%3A2022"
curl "http://localhost:3100/api/v1/standards/ISO%209001?source=TCVN_QT"
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

Detail fields are present as `null` when not found in the detail page. The API does not infer dates or an issuing agency from other fields. For TCVN records, `attributes` are the whitelisted metadata fields (see "TCVN"), and `raw` carries only the record key and detail URL — never the upstream JSON.

### Errors

Validation errors return `400`; missing standards return `404`; upstream failures return `502`; upstream timeouts return `504`; rate limits return `429`. Error responses do not include upstream HTML, upstream JSON, or stack traces.

```json
{
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "VSQI request timed out"
  },
  "source": "MULTI"
}
```

Error responses carry `source: "MULTI"` for merged search/detail, or the
requested source when `?source=` was given. Other error codes include
`INVALID_QUERY`, `INVALID_CODE`, `INVALID_SOURCE`, `NOT_FOUND`,
`UPSTREAM_HTTP_ERROR`, `UPSTREAM_UNAVAILABLE`, `INVALID_UPSTREAM_HTML`,
and `RATE_LIMIT_EXCEEDED`. Validation and rate-limit errors omit `source`
because they are not upstream errors.

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

Tests use local fixtures and mocked providers/HTTP responses; they do not depend on VSQI or TCVN availability. TCVN fixtures are small, hand-trimmed copies of live responses — they never contain the staff-user object or any other non-whitelisted field. To manually test a running local API against the live providers:

```sh
node scripts/live-test.mjs "TCVN 9143:2022"
```

Set `API_BASE_URL` to use another running API instance. Search/detail selectors should be rechecked if VSQI changes its HTML. Do not bypass login, CAPTCHA, access controls, or upstream rate limits, and do not fetch or redistribute full standard documents.
