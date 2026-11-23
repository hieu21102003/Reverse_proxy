# Standards DB — live integration test (elib + PostgreSQL thật)

Chạy **một lượt tích hợp thật** giữa Reverse_proxy (client) và elib +
PostgreSQL trên máy dev có Docker. Sandbox của Muse không có
Docker/PostgreSQL nên lượt chạy này do người dùng chạy trên máy dev;
file test là `tests/standards-db.live.test.ts` (tự skip khi thiếu env).

## 1. Dựng elib + PostgreSQL (repo elib-service)

```bash
cd ~/workspace/elib-service   # hoặc nơi bạn clone repo elib-service
cp .env.example .env
# Sửa .env: POSTGRES_PASSWORD (chữ/số), SESSION_SECRET,
# STANDARDS_INTERNAL_TOKEN=<chuỗi ngẫu nhiên dài>  (bắt buộc cho /internal/*)
docker network create elib-net   # nếu chưa có (compose khai external)
docker compose up -d --build
docker compose exec elib npm run migrate   # áp 001 + 002 + 003
docker compose exec elib wget -qO- http://127.0.0.1:3200/health
```

Elib không publish cổng 3200 ra host (quyết định 2026-11-23). Để test
từ host, chạy test **bên trong mạng Docker** hoặc tạm publish cổng chỉ
cho lượt test này bằng một override cục bộ (không commit):

```bash
# docker-compose.override.yml (chỉ trên máy dev, KHÔNG commit)
cat > docker-compose.override.yml <<'EOF'
services:
  elib:
    ports:
      - "127.0.0.1:3200:3200"
EOF
docker compose up -d
```

## 2. Chạy live test (repo Reverse_proxy)

Cần các file mẫu thật ở `~/workspace/standards-lookup-samples/`
(`detail-tcvn-9143-2012.json`, `detail-tcvn-9143-2022.json`,
`detail-iso-9001.json` — test đọc tương đối từ repo Reverse_proxy:
`../../standards-lookup-samples/`).

```bash
cd ~/workspace/reverse_proxy/repo
STANDARDS_LIVE_TEST=1 \
ELIB_BASE_URL=http://127.0.0.1:3200 \
STANDARDS_INTERNAL_TOKEN=<đúng token trong .env của elib> \
npx vitest run tests/standards-db.live.test.ts
```

Kỳ vọng: 3 test pass — (a) ingest 3 detail thật, (b) lookup trả về,
(d) detail DB của TCVN 9143:2012 có `replacedBy = TCVN 9143:2022`,
(c) hai lượt search ingest sạch.

## 3. Kiểm chứng search_log bằng SQL (API không lộ bảng này)

Trước khi chạy test, ghi lại số dòng; sau khi chạy, phải tăng đúng 2
(mỗi lượt tìm = 1 dòng, nhờ ingest đa nguồn một request):

```bash
docker compose exec postgres psql -U elib -d elib -c "SELECT count(*) FROM search_log;"
# chạy live test ở bước 2, rồi:
docker compose exec postgres psql -U elib -d elib -c "SELECT count(*) FROM search_log;"
docker compose exec postgres psql -U elib -d elib -c \
  "SELECT query_norm, had_result, created_at FROM search_log ORDER BY id DESC LIMIT 5;"
```

Kiểm tra thêm đồ thị thay thế:

```bash
docker compose exec postgres psql -U elib -d elib -c \
  "SELECT f.normalized_code AS from_code, t.normalized_code AS to_code, r.type
     FROM standard_relations r
     JOIN standards f ON f.id = r.from_id
     LEFT JOIN standards t ON t.id = r.to_id
    WHERE f.normalized_code IN ('TCVN9143:2022','ISO9001:2015');"
```

## 4. Dọn dẹp

```bash
rm docker-compose.override.yml   # bỏ publish cổng tạm
docker compose up -d             # về trạng thái không publish cổng
# Muốn xóa dữ liệu test: docker compose down -v (xóa cả volume pgdata!)
```

## Chưa kiểm chứng cho tới khi chạy lượt này

- Migration 003 trên PostgreSQL thật (kể cả chạy lại trên bản sao DB
  elib thật — điều kiện merge PR-A).
- Ingest/lookup thật qua HTTP giữa hai service (test hiện tại dùng
  stub đúng contract + contract test dùng chung hai repo).
- Render trình duyệt thật của UI detail (badge "Dữ liệu từ DB, có
  thể chưa đầy đủ", cảnh báo stale).
