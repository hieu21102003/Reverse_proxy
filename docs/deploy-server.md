# Reverse_proxy — Hướng dẫn deploy lên server (Linux)

Tài liệu này hướng dẫn chạy `hieu21102003/Reverse_proxy` (Smart.Rail UI + API tra cứu 3 nguồn VSQI/TCVN) trên server Linux thay cho Vercel.
Viết dựa trên code tại `master` (`0ab9b21`, gồm PR #1 tìm kiếm 3 nguồn + PR #2 giao diện Smart.Rail). **Chưa chạy thử trên server thật** — hãy kiểm tra bằng các lệnh health-check ở cuối từng bước.

> Khác Vercel ở đâu? Trên Vercel, entry là `src/vercel.ts` (serverless function, không `listen()`). Trên server, entry là `src/server.ts` → `node dist/server.js`, nghe `HOST:PORT` (mặc định `0.0.0.0:3100`). File `vercel.json` không cần nữa nhưng cứ để nguyên trong repo, không ảnh hưởng.

## Chọn cách deploy

- **Cách A — Docker (khuyên dùng):** repo đã có `Dockerfile` sẵn (Node 22, chạy user `node`, có healthcheck). Dễ cập nhật/rollback, không lệ thuộc Node cài trên máy.
- **Cách B — Node trực tiếp + systemd:** không cần Docker, nhưng phải tự cài Node ≥ 22.15 và quản lý service bằng systemd.

Cả hai cách đều nên đặt sau **nginx** (reverse proxy) để có domain + HTTPS và không mở thẳng cổng 3100 ra ngoài.

---

## Chuẩn bị (cả hai cách)

```bash
# 1. Lấy code
git clone https://github.com/hieu21102003/Reverse_proxy.git
cd Reverse_proxy

# 2. Tạo file .env từ mẫu trong repo
cp .env.example .env
```

Sửa `.env` cho production (xem file `.env.server.example` ở thư mục gốc repo). Điểm quan trọng:

| Biến | Giá trị production | Ghi chú |
|---|---|---|
| `HOST` | `0.0.0.0` (Docker) / `127.0.0.1` (Node sau nginx) | Node trực tiếp sau nginx thì chỉ nghe localhost |
| `PORT` | `3100` | Trùng cổng trong Dockerfile/nginx |
| `TRUST_PROXY` | `true` khi chạy sau nginx | Chỉ bật khi cổng 3100 không truy cập trực tiếp từ ngoài được |
| `CORS_ORIGIN` | để trống | Giao diện và API cùng origin qua nginx thì không cần CORS |
| `VSQI_BASE_URL` | `https://tieuchuan.vsqi.gov.vn` | Bắt buộc HTTPS, giữ nguyên |
| `TCVN_BASE_URL` | `http://tracuu.tcvn.vn/sdomain/front-api` | Giữ HTTP — host này reset HTTPS |
| `VSQI_TLS_SUPPLEMENTAL_CA` | `true` | Giữ nguyên; file `certs/*.der` trong repo phải đi kèm (Docker đã copy sẵn) |

> **Đừng xóa thư mục `certs/`**: VSQI thiếu chứng chỉ trung gian, app dùng file DER trong `certs/` để xác thực TLS đúng cách (vẫn bật kiểm tra chứng chỉ). Thiếu file này là VSQI sẽ lỗi.

---

## Cách A — Docker

### A1. Chạy nhanh bằng docker run

```bash
docker build -t vsqi-proxy-api .
docker run -d --name reverse-proxy --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3100:3100 vsqi-proxy-api
```

Chỉ map `127.0.0.1:3100` (không mở `0.0.0.0`) vì nginx sẽ đứng trước.

### A2. Hoặc dùng docker-compose (file `docker-compose.yml` ở thư mục gốc repo)

```bash
docker compose up -d --build
docker compose ps          # cột STATUS phải hiện (healthy)
docker compose logs -f     # xem log, Ctrl+C để thoát
```

### A3. Cập nhật / rollback

```bash
git pull
docker compose up -d --build   # build lại image mới, container tự thay thế
# Rollback: git checkout <commit cũ> && docker compose up -d --build
```

---

## Cách B — Node trực tiếp + systemd

```bash
# Cài Node 22 LTS (ví dụ dùng NodeSource trên Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # phải >= 22.15

# Build
npm ci
npm run build    # tạo dist/
```

Copy file `deploy/systemd/reverse-proxy.service` vào `/etc/systemd/system/`, sửa `WorkingDirectory` và `User` cho đúng máy, rồi:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now reverse-proxy
sudo systemctl status reverse-proxy
journalctl -u reverse-proxy -f   # xem log
```

Cập nhật: `git pull && npm ci && npm run build && sudo systemctl restart reverse-proxy`.

---

## Nginx + HTTPS

Copy `deploy/nginx/reverse-proxy.conf` vào `/etc/nginx/sites-available/`, sửa `server_name` thành domain của bạn, bật site rồi reload:

```bash
sudo ln -s /etc/nginx/sites-available/reverse-proxy.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# HTTPS miễn phí (cần domain trỏ về server trước)
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
```

Nhớ đặt `TRUST_PROXY=true` trong `.env` khi chạy sau nginx, và **chặn truy cập trực tiếp cổng 3100 từ ngoài** (firewall chỉ mở 80/443 + SSH):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## Kiểm tra sau deploy (bắt buộc)

```bash
curl http://127.0.0.1:3100/health
# -> {"status":"ok","service":"vsqi-proxy-api",...}

curl "http://127.0.0.1:3100/api/v1/standards/search?q=TCVN%209143&page=1"
# -> source MULTI, có kết quả TCVN_VN; nếu VSQI lỗi sẽ nằm trong partialFailures

curl "http://127.0.0.1:3100/api/v1/standards/ISO%209001?source=TCVN_QT"
# -> chi tiết ISO 9001 từ TCVN_QT

curl https://your-domain.example/health   # qua nginx + HTTPS
```

Mở `https://your-domain.example/` để xem giao diện Smart.Rail và thử tìm kiếm thật. **Đặc biệt kiểm tra VSQI trên mạng server**: ở môi trường sandbox của Muse, VSQI luôn lỗi TLS nên chưa xác minh được VSQI live — trên server của bạn, kết quả VSQI phải xuất hiện (không nằm trong `partialFailures`) thì mới coi là deploy xong.

## Xử lý sự cố thường gặp

- **VSQI nằm trong `partialFailures` / lỗi TLS:** kiểm tra còn thư mục `certs/` không, `VSQI_TLS_SUPPLEMENTAL_CA=true`, và server có ra được Internet tới `tieuchuan.vsqi.gov.vn:443` không. Đừng tắt kiểm tra chứng chỉ để "chữa cháy".
- **TCVN chậm/timeout:** `tracuu.tcvn.vn` thỉnh thoảng chậm ~1,5s, có lúc chạm timeout 10s (`HTTP_TIMEOUT_MS`). Một nguồn lỗi không làm hỏng cả lần tìm kiếm; chỉ khi cả 3 nguồn lỗi mới trả 502.
- **429 Too Many Requests:** giới hạn mặc định 30 request/phút (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`), tăng trong `.env` nếu cần. Lưu ý cache + rate-limit là theo từng process.
- **Trang mở được nhưng API bị chặn (CORS):** nếu giao diện và API khác origin, đặt `CORS_ORIGIN` đúng 1 origin HTTPS của giao diện. Qua nginx cùng domain thì để trống.

## Ghi chú cho bước elib sau này

Khi tích hợp elib (dịch vụ elib riêng, cổng 3200), Reverse_proxy sẽ cần thêm proxy `/api/elib/*` → elib. Lúc đó elib nên chạy nội bộ (chỉ `127.0.0.1:3200`), người dùng chỉ vào qua nginx → Reverse_proxy. Chưa cần làm gì ở bước deploy này ngoài việc chừa cổng 3200 trống.
