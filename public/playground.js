(() => {
  const OTHER_ATTRIBUTE_LABEL = 'Thông tin khác';

  const HEADER_LABELS = {
    code: ['số hiệu'],
    titleVi: ['tên tiếng việt'],
    titleEn: ['tên tiếng anh'],
    status: ['tình trạng'],
    year: ['năm ban hành', 'năm công bố, ban hành', 'năm công bố ban hành']
  };

  const GENERAL_LABELS = new Set([
    'quyết định công bố',
    'cơ quan ban hành',
    'cơ quan biên soạn',
    'số trang',
    'chỉ số phân loại quốc tế (ics)',
    'giá',
    'ngày ban hành',
    'văn bản công bố, ban hành',
    'ban kỹ thuật',
    'lĩnh vực chuyên ngành'
  ]);

  const SCOPE_LABELS = new Set(['phạm vi áp dụng', 'đối tượng áp dụng']);
  const HISTORY_LABELS = new Set(['lịch sử soát xét']);
  const RELATED_RELATION_TYPES = new Set(['replaces', 'replacedBy', 'equivalent', 'normativeReference', 'specializedField', 'other']);
  const RELATED_TYPE_ORDER = ['replaces', 'replacedBy', 'equivalent', 'normativeReference', 'specializedField', 'other'];
  const RELATED_TYPE_LABELS = {
    replaces: 'Replaces',
    replacedBy: 'Replaced by',
    equivalent: 'Equivalent standards',
    normativeReference: 'Normative references',
    specializedField: 'Specialized fields',
    other: 'Other relations'
  };

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function valueText(value) {
    return hasValue(value) ? String(value) : 'N/A';
  }

  function firstText(...values) {
    for (const value of values) {
      if (hasValue(value)) return String(value).trim();
    }
    return null;
  }

  function normalizeLabel(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s*:\s*$/, '')
      .toLowerCase();
  }

  function safeWebUrl(value) {
    if (typeof value !== 'string') return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function statusTone(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return 'other';
    if (/withdrawn|hết hiệu lực|hết lực|invalid|replaced|bị thay thế|\bw\s*-/.test(text)) return 'withdrawn';
    if (/còn hiệu lực|\bactive\b|\ba\s*-/.test(text)) return 'active';
    return 'other';
  }

  function deriveStandardType(data, code) {
    const pageType = data?.raw?.page?.pageType;
    if (pageType === 'regulation') return 'Quy chuẩn quốc gia';
    if (pageType === 'standard') return 'Tiêu chuẩn quốc gia';
    const prefix = String(code ?? '').trim().toUpperCase();
    if (prefix.startsWith('QCVN')) return 'Quy chuẩn quốc gia';
    if (prefix.startsWith('TCVN')) return 'Tiêu chuẩn quốc gia';
    if (prefix.startsWith('TCXD')) return 'Tiêu chuẩn xây dựng';
    if (prefix.startsWith('TCN')) return 'Tiêu chuẩn ngành';
    if (prefix.startsWith('TCCS')) return 'Tiêu chuẩn cơ sở';
    return null;
  }

  function buildDetailViewModel(data) {
    if (!data || typeof data !== 'object') {
      return {
        header: { code: null, titleVi: null, titleEn: null, status: null, type: null, year: null },
        general: [],
        scope: [],
        related: [],
        history: [],
        other: [],
        source: null,
        db: null,
        fallbackLinks: [],
        isEmpty: true
      };
    }

    const attributes = Array.isArray(data.attributes) ? data.attributes : [];
    const relations = Array.isArray(data.relations) ? data.relations : [];
    const consumed = new Set();

    const takeAttribute = labels => {
      const wanted = new Set(labels);
      for (let index = 0; index < attributes.length; index += 1) {
        if (consumed.has(index)) continue;
        if (wanted.has(normalizeLabel(attributes[index]?.label))) {
          consumed.add(index);
          return { attribute: attributes[index], index };
        }
      }
      return null;
    };

    const codeAttribute = takeAttribute(HEADER_LABELS.code);
    const titleViAttribute = takeAttribute(HEADER_LABELS.titleVi);
    const titleEnAttribute = takeAttribute(HEADER_LABELS.titleEn);
    const statusAttribute = takeAttribute(HEADER_LABELS.status);
    const yearAttribute = takeAttribute(HEADER_LABELS.year);

    const code = firstText(codeAttribute?.attribute?.value, data.code);
    const titleVi = firstText(titleViAttribute?.attribute?.value, data.name);
    const titleEn = firstText(titleEnAttribute?.attribute?.value, data.englishName);
    const statusText = firstText(statusAttribute?.attribute?.value, data.status);
    const year = firstText(yearAttribute?.attribute?.value, data.year);

    const history = [];
    const historyAttributeIndexes = new Set();
    for (const relation of relations) {
      if (relation?.type !== 'history') continue;
      if (Number.isInteger(relation.sourceAttributeIndex) && relation.sourceAttributeIndex >= 0) {
        historyAttributeIndexes.add(relation.sourceAttributeIndex);
      }
      history.push({
        code: firstText(relation.code),
        status: firstText(relation.status),
        note: firstText(relation.note),
        active: typeof relation.active === 'boolean' ? relation.active : null,
        url: safeWebUrl(relation.url),
        text: firstText(relation.text)
      });
    }
    if (history.length === 0) {
      attributes.forEach((attribute, index) => {
        if (!HISTORY_LABELS.has(normalizeLabel(attribute?.label))) return;
        historyAttributeIndexes.add(index);
        for (const list of attribute?.lists || []) {
          for (const entry of list?.items || []) {
            if (!entry?.history) continue;
            history.push({
              code: firstText(entry.history.code),
              status: firstText(entry.history.status),
              note: firstText(entry.history.note),
              active: typeof entry.history.active === 'boolean' ? entry.history.active : null,
              url: safeWebUrl(entry.links?.find(link => safeWebUrl(link?.href))?.href),
              text: firstText(entry.text)
            });
          }
        }
      });
    }

    const related = [];
    const relatedMap = new Map();
    const relationAttributeIndexes = new Set();
    for (const relation of relations) {
      if (!relation || !RELATED_RELATION_TYPES.has(relation.type)) continue;
      const text = firstText(relation.text);
      const relationCode = firstText(relation.code);
      const url = safeWebUrl(relation.url);
      if (!text && !relationCode && !url) continue;
      if (Number.isInteger(relation.sourceAttributeIndex) && relation.sourceAttributeIndex >= 0) {
        relationAttributeIndexes.add(relation.sourceAttributeIndex);
      }
      const label = firstText(relation.label) || RELATED_TYPE_LABELS[relation.type] || 'Related standards';
      const key = `${relation.type}:${label}`;
      let group = relatedMap.get(key);
      if (!group) {
        group = { type: relation.type, label, entries: [] };
        relatedMap.set(key, group);
        related.push(group);
      }
      group.entries.push({
        text: text || relationCode,
        code: relationCode,
        url,
        index: Number.isInteger(relation.sourceAttributeIndex) ? relation.sourceAttributeIndex : -1,
        status: firstText(relation.status) ? { text: firstText(relation.status), tone: statusTone(relation.status) } : null
      });
    }
    related.sort((left, right) => {
      const leftIndex = RELATED_TYPE_ORDER.indexOf(left.type);
      const rightIndex = RELATED_TYPE_ORDER.indexOf(right.type);
      return (leftIndex < 0 ? RELATED_TYPE_ORDER.length : leftIndex) - (rightIndex < 0 ? RELATED_TYPE_ORDER.length : rightIndex);
    });

    // Normative-reference relations often expose only the standard code, while
    // the source attribute contains the full reference text. Keep that text so
    // no attribute content is lost, and add the shared introduction when present.
    for (const group of related) {
      const sourceIndexes = new Set(group.entries.map(entry => entry.index).filter(index => Number.isInteger(index) && index >= 0));
      if (sourceIndexes.size !== 1) continue;
      const index = [...sourceIndexes][0];
      const lines = String(attributes[index]?.value ?? '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      if (lines.length === 0) continue;
      const used = new Set();
      let matched = false;
      for (const entry of group.entries) {
        if (!entry.code) continue;
        const lineIndex = lines.findIndex((line, linePosition) => !used.has(linePosition) && line.includes(entry.code));
        if (lineIndex < 0) continue;
        used.add(lineIndex);
        entry.text = lines[lineIndex];
        matched = true;
      }
      if (matched && used.size > 0) {
        const intro = lines.slice(0, Math.min(...used)).join('\n');
        if (intro) group.intro = intro;
      }
    }

    const general = [];
    const scope = [];
    const other = [];

    attributes.forEach((attribute, index) => {
      if (consumed.has(index)) return;
      const label = firstText(attribute?.label) || 'Attribute';
      const key = normalizeLabel(label);
      const item = { label, value: attribute?.value ?? null, index };

      if (SCOPE_LABELS.has(key)) {
        scope.push(item);
        consumed.add(index);
        return;
      }
      if (historyAttributeIndexes.has(index)) {
        consumed.add(index);
        return;
      }
      if (relationAttributeIndexes.has(index)) {
        consumed.add(index);
        return;
      }
      if (GENERAL_LABELS.has(key)) {
        general.push(item);
        consumed.add(index);
        return;
      }
      other.push(item);
    });

    const sourceUrl = safeWebUrl(data.detailUrl) || safeWebUrl(data?.raw?.page?.detailUrl);
    let sourceHost = null;
    if (sourceUrl) {
      try {
        sourceHost = new URL(sourceUrl).host;
      } catch {
        sourceHost = null;
      }
    }
    const source = (sourceUrl || firstText(data.source))
      ? {
          website: firstText(data.source) || 'VSQI',
          host: sourceHost,
          url: sourceUrl
        }
      : null;

    // Metadata-DB provenance (present only when the API ran with
    // STANDARDS_DB_ENABLED): drives the "kiểm tra lần cuối" row, the
    // DB source badge, and the stale-data warning.
    const dbInfo = (data.dbInfo && typeof data.dbInfo === 'object') ? data.dbInfo : null;
    const db = dbInfo
      ? {
          servedFrom: dbInfo.servedFrom === 'db' ? 'db' : 'live',
          lastVerifiedAt: firstText(dbInfo.lastVerifiedAt),
          stale: dbInfo.stale === true,
          staleDays: Number.isFinite(Number(dbInfo.staleDays)) ? Number(dbInfo.staleDays) : null
        }
      : null;

    // Fallback links replace the TCVN front-api detailUrl (a JSON API
    // URL, not a public page) as the "view at source" affordance:
    // VSQI page when a VSQI snapshot exists, else ISO OBP + Google
    // searches by code. A real VSQI detailUrl keeps the normal
    // source link and needs no fallbacks.
    const fallbackLinks = [];
    const isTcvnApiUrl = sourceHost === 'tracuu.tcvn.vn';
    if (code && (isTcvnApiUrl || !sourceUrl)) {
      const vsqiSnapshot = Array.isArray(dbInfo?.sources)
        ? dbInfo.sources.find(entry => entry?.source === 'VSQI' && safeWebUrl(entry?.detailUrl))
        : null;
      if (vsqiSnapshot) {
        fallbackLinks.push({ kind: 'vsqi', url: safeWebUrl(vsqiSnapshot.detailUrl) });
      }
      fallbackLinks.push({
        kind: 'iso-obp',
        url: `https://www.iso.org/obp/ui/?q=${encodeURIComponent(code)}#search`
      });
      fallbackLinks.push({
        kind: 'google',
        url: `https://www.google.com/search?q=${encodeURIComponent(code)}`
      });
    }

    const isEmpty = !code && !titleVi && !titleEn && !statusText && !year
      && general.length === 0 && scope.length === 0 && related.length === 0
      && history.length === 0 && other.length === 0 && !source;

    return {
      header: {
        code,
        titleVi,
        titleEn,
        status: statusText ? { text: statusText, tone: statusTone(statusText) } : null,
        type: deriveStandardType(data, code),
        year
      },
      general,
      scope,
      related,
      history,
      other,
      otherLabel: OTHER_ATTRIBUTE_LABEL,
      source,
      db,
      fallbackLinks,
      isEmpty
    };
  }

  const detailModel = {
    buildDetailViewModel,
    deriveStandardType,
    normalizeLabel,
    safeWebUrl,
    statusTone,
    valueText
  };

  // Pure helpers for elib file cards (also exercised by tests without a DOM).
  function fileKindFromName(filename, mimeType) {
    const name = String(filename || '').toLowerCase();
    const mime = String(mimeType || '').toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
    if (['doc', 'docx', 'odt', 'rtf'].includes(ext) || mime.includes('word') || mime.includes('officedocument.wordprocessing')) return 'doc';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'xls';
    if (['ppt', 'pptx', 'odp'].includes(ext) || mime.includes('presentation') || mime.includes('powerpoint')) return 'ppt';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(ext) || mime.startsWith('image/')) return 'img';
    if (['txt', 'md', 'log'].includes(ext) || mime === 'text/plain') return 'txt';
    if (ext === 'dwg' || mime.includes('dwg') || mime.includes('autocad')) return 'dwg';
    return 'other';
  }

  function needsLoginForDoc(doc, user) {
    if (user) return false;
    if (!doc || typeof doc !== 'object') return true;
    return doc.visibility !== 'public' || doc.status !== 'published';
  }

  function formatFileSize(bytes) {
    if (bytes === null || bytes === undefined || bytes === '') return '—';
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function elibDownloadPath(doc) {
    const file = doc?.file;
    if (!doc?.id || !file?.id) return null;
    return `/api/elib/documents/${encodeURIComponent(doc.id)}/files/${encodeURIComponent(file.id)}/download`;
  }

  function elibPreviewPath(doc) {
    if (!doc?.id) return null;
    return `/api/elib/documents/${encodeURIComponent(doc.id)}/preview`;
  }

  function elibViewPath(doc) {
    if (!doc?.id) return null;
    return `/api/elib/documents/${encodeURIComponent(doc.id)}/view`;
  }

  /**
   * Trạng thái nút xem trên thẻ file, suy từ trường API của elib
   * (snake_case: file.preview_status / preview_pages / page_count,
   * can_view_full ở cấp tài liệu — đúng response thật của elib).
   * - ready -> nút "Xem trước"; pending/processing -> "Đang chuẩn bị"
   *   (không bấm được); failed/unsupported -> không có nút xem trước.
   * - "Xem toàn bộ" chỉ khi can_view_full (chủ tài liệu + admin).
   */
  function previewAffordance(doc) {
    const file = doc?.file;
    const status = file?.preview_status ?? null;
    const kind = fileKindFromName(file?.original_filename, file?.mime_type);
    return {
      showPreview: status === 'ready',
      showPreparing: status === 'pending' || status === 'processing',
      showViewFull: doc?.can_view_full === true,
      isImage: kind === 'img',
      previewPages: Number.isInteger(file?.preview_pages) ? file.preview_pages : null,
      pageCount: Number.isInteger(file?.page_count) ? file.page_count : null,
      previewStatus: status
    };
  }

  /**
   * Trạng thái nút tải trên thẻ file, suy từ can_download của elib
   * (chỉ chủ tài liệu + admin mới true; ẩn danh luôn false):
   * - không có file -> 'none' (không hiện gì);
   * - can_download === true -> 'download' (nút "Tải xuống");
   * - còn lại: đã đăng nhập -> 'contact' (gợi ý liên hệ xin quyền),
   *   chưa đăng nhập -> 'login' (nút "Đăng nhập để tải" như trước).
   * Thiếu trường can_download (elib cũ chưa gửi) được coi là false:
   * fail-closed, không hiện nút tải khi chưa rõ quyền.
   */
  function downloadAffordance(doc, user) {
    if (!elibDownloadPath(doc)) return 'none';
    if (doc?.can_download === true) return 'download';
    return user ? 'contact' : 'login';
  }

  /**
   * Nút tải/in trên thanh công cụ viewer: chỉ ở chế độ toàn bộ
   * (full/image), tải cần can_download, in/mở bản gốc cần
   * can_view_full. Chế độ xem trước luôn ẩn cả hai.
   */
  function viewerToolbar(doc, mode) {
    const full = mode === 'full' || mode === 'image';
    return {
      showDownload: full && doc?.can_download === true && elibDownloadPath(doc) !== null,
      showPrint: full && doc?.can_view_full === true
    };
  }

  /** Map mã lỗi ổn định của endpoint download sang khóa i18n (không parse message). */
  function downloadErrorKey(status, code) {
    if (code === 'DOWNLOAD_FORBIDDEN' || status === 403) return 'downloadForbidden';
    if (status === 404) return 'downloadNotFound';
    if (status === 429) return 'downloadRateLimited';
    return 'downloadFailed';
  }

  /** Tên file từ header Content-Disposition (ưu tiên filename* UTF-8), null nếu không có. */
  function filenameFromDisposition(header) {
    if (typeof header !== 'string' || !header) return null;
    const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (star) {
      try { return decodeURIComponent(star[1].trim()); } catch { return star[1].trim(); }
    }
    const plain = /filename="?([^";]+)"?/i.exec(header);
    return plain ? plain[1].trim() : null;
  }

  /** Map mã lỗi ổn định của endpoint preview/view sang khóa i18n (không parse message). */
  function previewErrorKey(status, code) {
    if (code === 'PREVIEW_NOT_READY') return 'previewNotReady';
    if (code === 'PREVIEW_UNSUPPORTED' || status === 415) return 'previewUnsupported';
    if (code === 'PREVIEW_NOT_AVAILABLE' || status === 403) return 'previewNotAvailable';
    if (status === 429) return 'previewRateLimited';
    if (status === 404) return 'previewNotFound';
    return 'previewLoadError';
  }

  /**
   * Kiểm tra cặp mật khẩu phía client (máy chủ vẫn là thẩm quyền):
   * 8–128 ký tự, hai ô phải khớp. Trả khóa i18n hoặc null khi hợp lệ.
   */
  function passwordPairErrorKey(password, confirm) {
    const value = typeof password === 'string' ? password : '';
    if (value.length < 8) return 'regPasswordShort';
    if (value.length > 128) return 'regPasswordLong';
    if (value !== confirm) return 'regPasswordMismatch';
    return null;
  }

  /**
   * Kiểm tra form đăng ký phía client, khớp luật của elib A3
   * (username 3–50 không khoảng trắng/@, email hợp lệ, họ tên bắt
   * buộc). Trả khóa i18n của lỗi đầu tiên hoặc null.
   */
  function validateRegistration(input) {
    const data = input && typeof input === 'object' ? input : {};
    const username = typeof data.username === 'string' ? data.username.trim() : '';
    if (username.length < 3 || username.length > 50 || /\s/.test(username) || username.includes('@')) {
      return 'regUsernameInvalid';
    }
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'regEmailInvalid';
    const fullName = typeof data.fullName === 'string' ? data.fullName.trim() : '';
    if (!fullName) return 'regFullNameRequired';
    return passwordPairErrorKey(data.password, data.passwordConfirm);
  }

  /** Map mã lỗi ổn định của POST /auth/register sang khóa i18n. */
  function registerErrorKey(status, code) {
    if (code === 'USERNAME_TAKEN') return 'regUsernameTaken';
    if (code === 'EMAIL_TAKEN') return 'regEmailTaken';
    if (code === 'INVALID_USERNAME') return 'regUsernameInvalid';
    if (code === 'PASSWORD_TOO_SHORT') return 'regPasswordShort';
    if (code === 'PASSWORD_TOO_LONG') return 'regPasswordLong';
    if (code === 'PASSWORD_TOO_COMMON') return 'regPasswordCommon';
    if (code === 'PASSWORD_EQUALS_IDENTITY') return 'regPasswordIdentity';
    if (code === 'PENDING_LIMIT_REACHED') return 'regPendingLimit';
    if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_BANNED' || status === 429) return 'regRateLimited';
    if (code === 'INVALID_INPUT' || status === 400) return 'regInvalidInput';
    return 'regFailed';
  }

  /**
   * Map lỗi đăng nhập: elib chỉ lộ trạng thái tài khoản SAU khi mật
   * khẩu đúng (ACCOUNT_PENDING / ACCOUNT_NOT_ACTIVE); sai mật khẩu
   * và khóa tạm đều là lỗi chung 401 (chống dò tài khoản).
   */
  function loginErrorKey(status, code) {
    if (code === 'ACCOUNT_PENDING') return 'loginPending';
    if (code === 'ACCOUNT_NOT_ACTIVE') return 'loginNotActive';
    if (code === 'RATE_LIMITED' || code === 'RATE_LIMIT_BANNED' || status === 429) return 'loginRateLimited';
    return 'elibLoginFailed';
  }

  /** Map lỗi đổi mật khẩu (sai mật khẩu hiện tại = 401). */
  function changePasswordErrorKey(status, code) {
    if (status === 401) return 'changeWrongCurrent';
    if (code === 'PASSWORD_TOO_SHORT') return 'regPasswordShort';
    if (code === 'PASSWORD_TOO_LONG') return 'regPasswordLong';
    if (code === 'PASSWORD_TOO_COMMON') return 'regPasswordCommon';
    if (code === 'PASSWORD_EQUALS_IDENTITY') return 'regPasswordIdentity';
    if (status === 400) return 'regInvalidInput';
    return 'changeFailed';
  }

  /** Map mã lỗi ổn định của API quản trị người dùng sang khóa i18n. */
  function adminErrorKey(status, code) {
    if (code === 'INVALID_USER_TYPE') return 'adminErrUserType';
    if (code === 'NOT_PENDING') return 'adminErrNotPending';
    if (code === 'INVALID_REJECT_REASON') return 'adminErrRejectReason';
    if (code === 'INVALID_STATUS_TRANSITION') return 'adminErrStatusTransition';
    if (code === 'CANNOT_MODIFY_SELF') return 'adminErrSelf';
    if (code === 'LAST_ADMIN') return 'adminErrLastAdmin';
    if (code === 'EDITOR_REQUIRES_INTERNAL') return 'adminErrEditorInternal';
    if (code === 'NOT_FOUND' || status === 404) return 'adminErrNotFound';
    if (status === 401) return 'adminErrLoginRequired';
    if (status === 403) return 'adminErrForbidden';
    if (status === 400) return 'regInvalidInput';
    return 'adminErrFailed';
  }

  /** Trang quản trị người dùng chỉ dành cho admin. */
  function isAdminUser(user) {
    return Boolean(user && user.role === 'admin');
  }

  /**
   * Các role được phép gán cho một người dùng: editor chỉ dành cho
   * người nội bộ (user_type=internal) — khớp luật phía elib.
   */
  function roleOptionsForUser(user) {
    return user && user.user_type === 'internal' ? ['viewer', 'editor', 'admin'] : ['viewer', 'admin'];
  }

  /** Hết trang xem trước: chưa đăng nhập -> mời đăng nhập; đã đăng nhập -> liên hệ chủ tài liệu. */
  function endOfPreviewKind(user) {
    return user ? 'contact' : 'login';
  }

  /**
   * Trạng thái "không có preview" suy từ preview_status (Giai đoạn B2):
   * trả khóa i18n để viewer hiện thông báo rõ thay vì lỗi trống, hoặc
   * null khi preview sẵn sàng / chưa rõ trạng thái (khi đó cứ gọi
   * endpoint preview và map lỗi theo mã ổn định như trước).
   * PDF 1 trang: elib đánh unsupported + page_count=1 (preview sẽ bằng
   * toàn bộ nội dung) -> thông báo riêng "không có bản xem trước".
   */
  function previewStateKey(doc) {
    const file = doc?.file;
    const status = file?.preview_status ?? null;
    if (status === 'pending' || status === 'processing') return 'previewPreparingLong';
    if (status === 'failed') return 'previewFailed';
    if (status === 'unsupported') {
      const kind = fileKindFromName(file?.original_filename, file?.mime_type);
      if (kind === 'pdf' && file?.page_count === 1) return 'previewNotAvailable';
      return 'previewUnsupported';
    }
    return null;
  }

  /** Deep link tài liệu: #doc=<id> (chia sẻ/mở lại đúng tài liệu). */
  function parseDocDeepLink(hash) {
    if (typeof hash !== 'string' || !hash) return null;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const id = params.get('doc');
    if (!id) return null;
    const trimmed = id.trim();
    return trimmed && trimmed.length <= 200 ? trimmed : null;
  }

  function docDeepLinkHash(id) {
    return `#doc=${encodeURIComponent(String(id))}`;
  }

  /**
   * Ai được đổi mức hiển thị (visibility) — khớp luật phía elib
   * (PATCH /api/documents/:id: admin hoặc người tạo). List response
   * của elib có created_by nên nhận diện được chủ tài liệu.
   */
  function canChangeVisibility(user, doc) {
    if (!user || !doc) return false;
    if (user.role === 'admin') return true;
    return Boolean(user.id && doc.created_by && user.id === doc.created_by);
  }

  /** Map mã lỗi ổn định của PATCH visibility sang khóa i18n. */
  function visibilityErrorKey(status, code) {
    if (code === 'INVALID_VISIBILITY' || status === 400) return 'visibilityInvalid';
    if (status === 401) return 'visibilityLoginRequired';
    if (status === 403) return 'visibilityForbidden';
    if (status === 404) return 'visibilityNotFound';
    return 'visibilityFailed';
  }

  /**
   * Chuẩn hóa kênh liên hệ từ /api/v1/ui-config cho panel hết preview:
   * chỉ giữ URL http(s)/mailto (chặn javascript: và các scheme lạ),
   * text cắt khoảng trắng; rỗng cả hai -> { text: null, url: null }.
   */
  function normalizeContact(contact) {
    const text = typeof contact?.elibContactText === 'string' ? contact.elibContactText.trim() : '';
    let url = typeof contact?.elibContactUrl === 'string' ? contact.elibContactUrl.trim() : '';
    if (url && !/^(https?:\/\/|mailto:)/i.test(url)) url = '';
    return { text: text || null, url: url || null };
  }

  /**
   * Ai được tải file tiêu chuẩn lên — khớp luật phía elib
   * (canUploadStandardFile: admin hoặc user_type=internal, phải đang
   * status=active). auth/me trả userType (camelCase) + status.
   */
  function canUploadStandardFile(user) {
    if (!user || typeof user !== 'object') return false;
    if (user.status !== 'active') return false;
    return user.role === 'admin' || user.userType === 'internal';
  }

  /** Đường dẫn elib (sau /api/elib) lấy file theo mã chuẩn như đang hiển thị. */
  function standardFilesPath(code) {
    return `/standards/${encodeURIComponent(String(code ?? '').trim())}/files`;
  }

  /**
   * Trạng thái mục "File tiêu chuẩn" trên trang chi tiết, suy từ kết
   * quả elibFetchJson của GET /api/elib/standards/:code/files:
   * - 'unavailable': elib tắt/lỗi/đang bảo trì, hoặc elib cũ chưa có
   *   route này (404 ROUTE_NOT_FOUND của handler không khớp route) ->
   *   ẩn hẳn mục, không hiện lỗi, trang metadata vẫn dùng bình thường.
   * - 'no-file': elib mới trả 200 mà document=null, hoặc 404 NOT_FOUND
   *   (tiêu chuẩn chưa có trong DB — tải lên sẽ tạo bản ghi) -> chưa có file.
   * - 'file-view': có file hiện hành và được xem toàn bộ (can_view_full).
   * - 'file-noaccess': thấy tài liệu trong danh sách nhưng không được
   *   xem toàn bộ (vd editor external) — chỉ xem trước nếu có.
   */
  function standardFileState(result) {
    if (!result || typeof result !== 'object') return 'unavailable';
    if (result.status === 200 && result.payload && typeof result.payload === 'object') {
      const doc = result.payload.document;
      if (!doc || typeof doc !== 'object') return 'no-file';
      return doc.can_view_full === true ? 'file-view' : 'file-noaccess';
    }
    if (result.status === 404 && result.errorCode === 'NOT_FOUND') return 'no-file';
    return 'unavailable';
  }

  /**
   * Chuyển payload GET standards/:code/files thành shape tài liệu mà
   * viewer/nút tải hiện có dùng (file = file hiện hành của elib).
   */
  function buildStandardFileDoc(payload) {
    const doc = payload?.document;
    if (!doc || typeof doc !== 'object') return null;
    const current = payload.current_file && typeof payload.current_file === 'object'
      ? payload.current_file
      : null;
    return {
      id: doc.id,
      title: doc.title,
      visibility: doc.visibility,
      status: doc.status,
      created_by: doc.created_by ?? null,
      current_file_id: doc.current_file_id ?? current?.id ?? null,
      can_view_full: doc.can_view_full === true,
      can_download: doc.can_download === true,
      file: current
    };
  }

  /** Cảnh báo kiểm tra mã chuẩn: chỉ not_found mới hiện badge cảnh báo. */
  function codeCheckWarningKey(file) {
    return file?.code_check_status === 'not_found' ? 'codeCheckNotFound' : null;
  }

  /** Map mã lỗi ổn định của upload file tiêu chuẩn sang khóa i18n. */
  function standardUploadErrorKey(status, code) {
    if (code === 'STANDARD_FILE_MUST_BE_PDF') return 'standardFileMustPdf';
    if (code === 'INVALID_STANDARD_CODE') return 'standardCodeInvalid';
    if (code === 'FILE_TOO_LARGE' || status === 413) return 'standardFileTooLarge';
    if (status === 401) return 'standardUploadLoginRequired';
    if (status === 403) return 'standardUploadForbidden';
    if (status === 429) return 'downloadRateLimited';
    return 'standardUploadFailed';
  }

  /**
   * Trang chi tiết "tóm tắt": một số tiêu chuẩn chỉ có ở kết quả tìm
   * kiếm (vd TCVN 14553-1:2025 chỉ có ở VSQI search, VSQI detail 500,
   * TCVN_VN/QT chưa có) nên API chi tiết trả 404/lỗi. Khi trang được
   * mở từ một kết quả tìm kiếm (có dữ liệu tóm tắt của đúng mã đó),
   * trang vẫn mở bằng dữ liệu tóm tắt: trường đã biết điền sẵn,
   * trường thiếu để trống (—) kèm ghi chú rõ ràng. Mở trực tiếp bằng
   * liên kết/mã gõ tay (không có tóm tắt) giữ nguyên hành vi lỗi cũ.
   * Dữ liệu tóm tắt KHÔNG được lưu như một bản chi tiết thật
   * (memory.detail vẫn giữ response lỗi gốc của API).
   */
  function summaryMatchesCode(summary, code) {
    if (!summary || typeof summary !== 'object') return false;
    const summaryCode = String(summary.code ?? '').trim();
    const wanted = String(code ?? '').trim();
    return summaryCode !== '' && wanted !== '' && summaryCode === wanted;
  }

  /**
   * Dựng object chi tiết tổng hợp từ một mục kết quả tìm kiếm
   * (code/name/englishName/year/status/source/ics/detailUrl) để
   * buildDetailViewModel render như trang chi tiết thường. Trường
   * không có trong tóm tắt để null (hiển thị —). Đánh dấu
   * summaryOnly để UI hiện ghi chú tóm tắt và form nhập tay biết
   * cần tra bản ghi manual đã lưu. Trả null khi tóm tắt không có mã.
   */
  function buildSummaryDetail(summary) {
    if (!summary || typeof summary !== 'object') return null;
    const code = firstText(summary.code);
    if (!code) return null;
    const ics = (Array.isArray(summary.ics) ? summary.ics : [])
      .map(value => String(value ?? '').trim())
      .filter(Boolean);
    const yearNumber = Number(summary.year);
    const detailUrl = safeWebUrl(summary.detailUrl) || '';
    return {
      code,
      name: firstText(summary.name),
      englishName: firstText(summary.englishName),
      year: Number.isFinite(yearNumber) && yearNumber > 0 ? yearNumber : null,
      status: firstText(summary.status),
      issuedDate: null,
      effectiveDate: null,
      issuingAgency: null,
      replaces: null,
      replacedBy: null,
      detailUrl,
      ics,
      source: firstText(summary.source) || 'VSQI',
      summaryOnly: true,
      attributes: ics.length > 0
        ? [{ label: 'Chỉ số phân loại Quốc tế (ICS)', value: ics.join(', ') }]
        : [],
      relations: [],
      raw: { page: { pageType: 'unknown', detailUrl } }
    };
  }

  /**
   * Quyết định có dùng trang tóm tắt thay cho lỗi chi tiết hay không:
   * chỉ khi API chi tiết không dùng được (404/lỗi/không có data) VÀ
   * có tóm tắt của đúng mã đang xem. Chi tiết thật dùng được thì
   * luôn thắng (trả null). Trả object chi tiết tổng hợp hoặc null.
   */
  function resolveSummaryFallback(result, summary, code) {
    const usable = Boolean(result?.ok && result.payload?.data && typeof result.payload.data === 'object');
    if (usable) return null;
    if (!summaryMatchesCode(summary, code)) return null;
    return buildSummaryDetail(summary);
  }

  /** Đường dẫn elib (sau /api/elib) đọc/ghi metadata nhập tay theo mã. */
  function adminStandardPath(code) {
    return `/admin/standards/${encodeURIComponent(String(code ?? '').trim())}`;
  }

  /** Form nhập/sửa metadata chỉ dành cho admin (khớp elib: admin session). */
  function canEditStandardMetadata(user) {
    return isAdminUser(user);
  }

  /** Ô ICS nhập dạng chuỗi cách nhau bằng dấu phẩy -> mảng (bỏ rỗng, khử trùng). */
  function parseIcsInput(value) {
    const parts = Array.isArray(value)
      ? value.map(item => String(item ?? ''))
      : String(value ?? '').split(',');
    const seen = new Set();
    const out = [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  /** Mảng ICS -> chuỗi cho ô nhập (cách nhau bằng dấu phẩy). */
  function formatIcsInput(ics) {
    return parseIcsInput(ics).join(', ');
  }

  /** Chuẩn hóa ngày cho <input type="date">: giữ YYYY-MM-DD, còn lại rỗng. */
  function normalizeDateInput(value) {
    const text = String(value ?? '').trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : '';
  }

  /**
   * Đọc một trường từ bản ghi manual elib trả về (GET admin/standards).
   * Chấp nhận cả dạng phẳng lẫn bọc {standard}/{data} và khóa
   * snake_case/camelCase, vì elib đang được xây song song theo cùng
   * hợp đồng {title_vi, title_en, status, issued_date, effective_date,
   * replaces, replaced_by, ics[]}.
   */
  const STORED_FIELD_ALIASES = {
    title_vi: ['title_vi', 'titleVi'],
    title_en: ['title_en', 'titleEn'],
    status: ['status'],
    issued_date: ['issued_date', 'issuedDate'],
    effective_date: ['effective_date', 'effectiveDate'],
    replaces: ['replaces'],
    replaced_by: ['replaced_by', 'replacedBy'],
    ics: ['ics']
  };
  function storedStandardField(stored, key) {
    if (!stored || typeof stored !== 'object') return undefined;
    const holders = [stored, stored.standard, stored.data].filter(holder => holder && typeof holder === 'object');
    for (const holder of holders) {
      for (const alias of STORED_FIELD_ALIASES[key] || [key]) {
        const value = holder[alias];
        if (Array.isArray(value) ? value.length > 0 : hasValue(value)) return value;
      }
    }
    return undefined;
  }

  /**
   * Giá trị điền sẵn cho form nhập tay (mọi trường là chuỗi sẵn sàng
   * cho ô nhập; ics là chuỗi cách nhau bằng dấu phẩy):
   * - có chi tiết thật: lấy từ chi tiết;
   * - trang tóm tắt: lấy từ tóm tắt, bản ghi manual đã lưu (stored)
   *   ghi đè từng trường khi có giá trị;
   * - không có gì: để trống.
   */
  function buildManualPrefill(detail, summary, stored) {
    const empty = {
      title_vi: '', title_en: '', status: '', issued_date: '', effective_date: '',
      replaces: '', replaced_by: '', ics: ''
    };
    let base = { ...empty };
    if (detail && typeof detail === 'object') {
      base = {
        title_vi: firstText(detail.name) || '',
        title_en: firstText(detail.englishName) || '',
        status: firstText(detail.status) || '',
        issued_date: normalizeDateInput(detail.issuedDate),
        effective_date: normalizeDateInput(detail.effectiveDate),
        replaces: firstText(detail.replaces) || '',
        replaced_by: firstText(detail.replacedBy) || '',
        ics: formatIcsInput(detail.ics)
      };
    } else if (summary && typeof summary === 'object') {
      base = {
        ...empty,
        title_vi: firstText(summary.name) || '',
        title_en: firstText(summary.englishName) || '',
        status: firstText(summary.status) || '',
        ics: formatIcsInput(summary.ics)
      };
    }
    if (stored && typeof stored === 'object') {
      const storedIcs = storedStandardField(stored, 'ics');
      base = {
        title_vi: firstText(storedStandardField(stored, 'title_vi')) || base.title_vi,
        title_en: firstText(storedStandardField(stored, 'title_en')) || base.title_en,
        status: firstText(storedStandardField(stored, 'status')) || base.status,
        issued_date: normalizeDateInput(storedStandardField(stored, 'issued_date')) || base.issued_date,
        effective_date: normalizeDateInput(storedStandardField(stored, 'effective_date')) || base.effective_date,
        replaces: firstText(storedStandardField(stored, 'replaces')) || base.replaces,
        replaced_by: firstText(storedStandardField(stored, 'replaced_by')) || base.replaced_by,
        ics: storedIcs !== undefined ? formatIcsInput(storedIcs) : base.ics
      };
    }
    return base;
  }

  /**
   * Body PUT /api/admin/standards/:code theo hợp đồng elib (mọi
   * trường đều tùy chọn): trường chữ/ngày trống bị bỏ qua (không gửi
   * null để tránh elib từ chối kiểu), ics luôn gửi dạng mảng (rỗng
   * = xóa hết ICS). Hệ quả: xóa trắng một trường chữ trong form
   * không xóa giá trị đã lưu — cần elib xác nhận ngữ nghĩa null mới
   * hỗ trợ xóa trường.
   */
  function buildManualSavePayload(values) {
    const data = values && typeof values === 'object' ? values : {};
    const payload = {};
    for (const key of ['title_vi', 'title_en', 'status', 'replaces', 'replaced_by']) {
      const text = String(data[key] ?? '').trim();
      if (text) payload[key] = text;
    }
    for (const key of ['issued_date', 'effective_date']) {
      const date = normalizeDateInput(data[key]);
      if (date) payload[key] = date;
    }
    payload.ics = parseIcsInput(data.ics);
    return payload;
  }

  /** Map mã lỗi ổn định của API metadata nhập tay sang khóa i18n. */
  function manualSaveErrorKey(status, code) {
    if (code === 'INVALID_STANDARD_CODE') return 'standardCodeInvalid';
    if (status === 401) return 'manualLoginRequired';
    if (status === 403) return 'manualForbidden';
    if (status === 404) return 'manualNotFound';
    if (status === 400) return 'manualInvalid';
    if (status === 429) return 'downloadRateLimited';
    return 'manualSaveFailed';
  }

  // ---- PDF Table of Contents (P2) ----
  const TOC_POLL_INTERVAL_MS = 4000;
  const TOC_POLL_MAX_RETRIES = 2;

  /**
   * Đường dẫn proxy lấy mục lục PDF:
   * - có fileId tường minh hoặc file đang xem khác current_file_id -> /documents/:id/files/:fileId/toc
   * - mặc định -> /documents/:id/toc (phiên bản hiện hành).
   */
  function elibTocPath(doc, fileId) {
    const docId = doc?.id ? String(doc.id).trim() : '';
    if (!docId) return null;
    const explicitFileId = fileId !== undefined && fileId !== null ? String(fileId).trim() : '';
    if (explicitFileId) {
      return `/api/elib/documents/${encodeURIComponent(docId)}/files/${encodeURIComponent(explicitFileId)}/toc`;
    }
    const currentId = doc?.current_file_id ? String(doc.current_file_id).trim() : '';
    const docFileId = doc?.file?.id ? String(doc.file.id).trim() : '';
    if (currentId && docFileId && docFileId !== currentId) {
      return `/api/elib/documents/${encodeURIComponent(docId)}/files/${encodeURIComponent(docFileId)}/toc`;
    }
    return `/api/elib/documents/${encodeURIComponent(docId)}/toc`;
  }

  /**
   * Chuẩn hóa phản hồi API mục lục thành trạng thái hiển thị cho người đọc:
   * - state='processing' -> hiện thông báo đang tạo và poll tối đa 2 lần.
   * - displayable=true và có ít nhất 1 node -> ready (ẩn khi nodes rỗng,
   *   kể cả trường hợp admin lưu nodes: [] với effective_source='manual').
   * - Mọi trường hợp còn lại (failed/unsupported/not_enabled/partial/needs_ocr,
   *   404/403/502/503/lỗi mạng) -> hidden lặng lẽ.
   */
  function resolveTocViewState(result) {
    if (!result || typeof result !== 'object' || result.status !== 200 || !result.payload || typeof result.payload !== 'object') {
      return { kind: 'hidden' };
    }
    const payload = result.payload;
    const state = typeof payload.state === 'string' ? payload.state : null;
    if (state === 'processing') {
      return { kind: 'processing' };
    }
    const displayable = payload.displayable === true;
    const rawNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
    if (!displayable || rawNodes.length === 0) {
      return { kind: 'hidden' };
    }
    const effectiveSource = payload.effective_source === 'manual' || payload.effective_source === 'auto'
      ? payload.effective_source
      : null;
    const flags = Array.isArray(payload.flags) ? payload.flags.filter(flag => typeof flag === 'string') : [];
    return {
      kind: 'ready',
      nodes: rawNodes,
      previewOnly: payload.preview_only === true,
      effectiveSource,
      flags,
      showLevel1Note: flags.includes('contents_level1_only'),
      showManualBadge: effectiveSource === 'manual'
    };
  }

  function shouldPollToc(tocState, retryCount) {
    const count = Number(retryCount);
    return Boolean(tocState && tocState.kind === 'processing' && Number.isFinite(count) && count < TOC_POLL_MAX_RETRIES);
  }

  /** Chỉ hiển thị tối đa 2 nhãn phụ ở chân sidebar; ẩn toàn bộ cờ kỹ thuật khác. */
  function tocFooterKeys(tocState) {
    if (!tocState || tocState.kind !== 'ready') return [];
    const keys = [];
    if (tocState.showLevel1Note) keys.push('tocSummaryLevel1');
    if (tocState.showManualBadge) keys.push('tocManualVerified');
    return keys;
  }

  /**
   * Dựng cây mục lục từ mảng phẳng bằng một lượt duyệt stack theo `level`:
   * - Sắp xếp ổn định theo `sort`.
   * - Nhảy cấp (vd 1 -> 3) hoặc bắt đầu từ level > 1: gắn vào cha gần nhất có
   *   level nhỏ hơn, không sinh node ảo trung gian, không crash.
   * - Đọc trực tiếp cờ `locked` từ backend (khi `previewOnly === false` luôn mở khóa).
   * - Thêm node ảo "Trang đầu" -> trang 1 ở đầu cây khi cây có ít nhất 1 mục.
   */
  function buildTocTree(flatNodes, options = {}) {
    if (!Array.isArray(flatNodes) || flatNodes.length === 0) return [];
    const prepared = flatNodes
      .map((node, origIdx) => ({ node, origIdx }))
      .filter(item => item.node && typeof item.node === 'object');
    if (prepared.length === 0) return [];

    prepared.sort((a, b) => {
      const sa = Number.isFinite(Number(a.node.sort)) ? Number(a.node.sort) : a.origIdx + 1;
      const sb = Number.isFinite(Number(b.node.sort)) ? Number(b.node.sort) : b.origIdx + 1;
      return sa !== sb ? sa - sb : a.origIdx - b.origIdx;
    });

    const roots = [];
    const stack = [];
    for (let idx = 0; idx < prepared.length; idx += 1) {
      const raw = prepared[idx].node;
      const rawLevel = Math.trunc(Number(raw.level));
      const level = Number.isFinite(rawLevel) ? Math.min(6, Math.max(1, rawLevel)) : 1;
      const rawPage = Math.trunc(Number(raw.page_pdf));
      const pagePdf = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
      const sort = Number.isFinite(Number(raw.sort)) ? Number(raw.sort) : idx + 1;
      const locked = options.previewOnly === false ? false : raw.locked === true;
      const entry = {
        id: `toc-node-${idx}`,
        title: typeof raw.title === 'string' ? raw.title : String(raw.title ?? ''),
        level,
        page_pdf: pagePdf,
        sort,
        source: typeof raw.source === 'string' ? raw.source : null,
        confidence: typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : null,
        locked,
        virtual: false,
        children: []
      };
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(entry);
      } else {
        roots.push(entry);
      }
      stack.push(entry);
    }

    if (roots.length > 0 && options.includeFirstPage !== false) {
      const firstLabel = typeof options.firstPageLabel === 'string' && options.firstPageLabel.trim()
        ? options.firstPageLabel.trim()
        : 'Trang đầu';
      roots.unshift({
        id: 'toc-virtual-first',
        title: firstLabel,
        level: 1,
        page_pdf: 1,
        sort: 0,
        source: null,
        confidence: null,
        locked: false,
        virtual: true,
        children: []
      });
    }
    return roots;
  }

  /** Chuẩn hóa chuỗi tiếng Việt để tìm kiếm không phân biệt dấu và hoa/thường. */
  function normalizeTocSearchText(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Lọc cây mục lục theo từ khóa, giữ nhánh cha của các mục con khớp. */
  function filterTocTree(tree, query) {
    if (!Array.isArray(tree) || tree.length === 0) return [];
    const q = normalizeTocSearchText(query);
    if (!q) return tree;
    const visit = (nodes) => {
      const out = [];
      for (const node of nodes) {
        const selfMatch = normalizeTocSearchText(node.title).includes(q);
        const matchedChildren = Array.isArray(node.children) && node.children.length > 0
          ? visit(node.children)
          : [];
        if (selfMatch || matchedChildren.length > 0) {
          out.push({
            ...node,
            children: matchedChildren,
            matched: selfMatch,
            autoExpand: matchedChildren.length > 0
          });
        }
      }
      return out;
    };
    return visit(tree);
  }

  /** Tìm id mục đang đọc gần nhất (unlocked, có page_pdf <= currentPage). */
  function findActiveTocNodeId(tree, currentPage) {
    const page = Number(currentPage);
    if (!Array.isArray(tree) || tree.length === 0 || !Number.isFinite(page) || page < 1) return null;
    let best = null;
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node && node.locked !== true && Number.isFinite(node.page_pdf) && node.page_pdf <= page) {
          if (!best || node.page_pdf >= best.page_pdf) best = node;
        }
        if (node && Array.isArray(node.children) && node.children.length > 0) {
          walk(node.children);
        }
      }
    };
    walk(tree);
    return best ? best.id : null;
  }

  /** Quyết định hành động khi bấm vào 1 mục trong sidebar (locked không bao giờ nhảy trang). */
  function tocNodeClickAction(node, totalLoadedPages) {
    if (!node || typeof node !== 'object') return { action: 'noop' };
    if (node.locked === true) return { action: 'locked' };
    const page = Math.trunc(Number(node.page_pdf));
    if (!Number.isFinite(page) || page < 1) return { action: 'noop' };
    if (typeof totalLoadedPages === 'number' && Number.isFinite(totalLoadedPages) && totalLoadedPages > 0 && page > totalLoadedPages) {
      return { action: 'locked' };
    }
    return { action: 'jump', page };
  }

  /**
   * Dựng DOM cho cây mục lục bằng textContent/createElement thuần (tuyệt đối
   * không dùng innerHTML vì tiêu đề mục lục lấy từ PDF không đáng tin cậy).
   */
  function createTocListDom(docFactory, nodes, opts = {}) {
    if (!docFactory || !Array.isArray(nodes) || nodes.length === 0) return [];
    const labels = opts.labels || {};
    const collapsedIds = opts.collapsedIds instanceof Set ? opts.collapsedIds : null;
    const isSearching = Boolean(opts.isSearching);
    const activeId = opts.activeId || null;

    const makeLockSvg = () => {
      if (typeof docFactory.createElementNS !== 'function') {
        const fallback = docFactory.createElement('span');
        fallback.textContent = '🔒';
        return fallback;
      }
      const ns = 'http://www.w3.org/2000/svg';
      const svg = docFactory.createElementNS(ns, 'svg');
      svg.setAttribute('width', '12');
      svg.setAttribute('height', '12');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2.2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      const rect = docFactory.createElementNS(ns, 'rect');
      rect.setAttribute('x', '4');
      rect.setAttribute('y', '11');
      rect.setAttribute('width', '16');
      rect.setAttribute('height', '10');
      rect.setAttribute('rx', '2');
      const path = docFactory.createElementNS(ns, 'path');
      path.setAttribute('d', 'M8 11V7a4 4 0 0 1 8 0v4');
      svg.append(rect, path);
      return svg;
    };

    const buildItems = (items) => items.map((node) => {
      const li = docFactory.createElement('li');
      li.className = `toc-item toc-level-${node.level}`;
      li.setAttribute('data-toc-id', node.id);

      const row = docFactory.createElement('div');
      row.className = 'toc-row';

      const hasChildren = Array.isArray(node.children) && node.children.length > 0;
      const isCollapsed = hasChildren && !isSearching && Boolean(collapsedIds && collapsedIds.has(node.id));

      if (hasChildren) {
        const caret = docFactory.createElement('button');
        caret.type = 'button';
        caret.className = 'toc-caret';
        caret.textContent = isCollapsed ? '▸' : '▾';
        caret.setAttribute('aria-expanded', String(!isCollapsed));
        caret.setAttribute('aria-label', isCollapsed ? (labels.expand || 'Mở rộng mục con') : (labels.collapse || 'Thu gọn mục con'));
        caret.addEventListener('click', (event) => {
          event?.stopPropagation?.();
          opts.onToggleCollapse?.(node.id);
        });
        row.append(caret);
      } else {
        const spacer = docFactory.createElement('span');
        spacer.className = 'toc-caret-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        row.append(spacer);
      }

      const btn = docFactory.createElement('button');
      btn.type = 'button';
      const classes = ['toc-node-btn'];
      if (node.locked) classes.push('is-locked');
      if (node.id === activeId) classes.push('is-active');
      if (node.virtual) classes.push('is-virtual');
      if (isSearching && node.matched) classes.push('is-match');
      btn.className = classes.join(' ');
      btn.setAttribute('data-toc-id', node.id);
      btn.setAttribute('data-page', String(node.page_pdf));
      if (node.id === activeId) btn.setAttribute('aria-current', 'location');
      if (node.locked) {
        btn.setAttribute('data-locked', 'true');
        btn.setAttribute('aria-label', `${node.title} — ${labels.lockedLabel || 'Cần quyền xem toàn văn'}`);
      }

      const titleSpan = docFactory.createElement('span');
      titleSpan.className = 'toc-node-title';
      titleSpan.textContent = node.title;
      btn.append(titleSpan);

      const meta = docFactory.createElement('span');
      meta.className = 'toc-node-meta';
      if (node.locked) {
        const lockSpan = docFactory.createElement('span');
        lockSpan.className = 'toc-node-lock';
        lockSpan.setAttribute('aria-hidden', 'true');
        lockSpan.append(makeLockSvg());
        meta.append(lockSpan);
      }
      const pageSpan = docFactory.createElement('span');
      pageSpan.className = 'toc-node-page';
      pageSpan.textContent = String(node.page_pdf);
      meta.append(pageSpan);
      btn.append(meta);

      btn.addEventListener('click', () => {
        const totalLoaded = typeof opts.getTotalLoadedPages === 'function'
          ? opts.getTotalLoadedPages()
          : (opts.totalLoadedPages ?? null);
        const action = tocNodeClickAction(node, totalLoaded);
        if (action.action === 'locked') {
          opts.onLocked?.(node);
          return;
        }
        if (action.action === 'jump') {
          opts.onJump?.(action.page, node);
        }
      });

      row.append(btn);
      li.append(row);

      if (hasChildren) {
        const ul = docFactory.createElement('ul');
        ul.className = 'toc-children';
        ul.hidden = isCollapsed;
        for (const childLi of buildItems(node.children)) ul.append(childLi);
        li.append(ul);
      }
      return li;
    });

    return buildItems(nodes);
  }

  // ---- Admin PDF TOC management (P3) ----
  const ADMIN_TOC_MAX_NODES = 2000;
  const ADMIN_TOC_MAX_TITLE_LENGTH = 200;
  const ADMIN_TOC_MAX_NOTE_LENGTH = 500;
  const ADMIN_TOC_DEFAULT_LIMIT = 20;

  /** Chỉ admin đang hoạt động mới thấy màn hình quản trị mục lục (khớp canManageToc ở elib). */
  function canManageAdminTocs(user) {
    return Boolean(
      user &&
      typeof user === 'object' &&
      user.role === 'admin' &&
      (user.status === undefined || user.status === 'active')
    );
  }

  /** Đường dẫn GET danh sách rà soát mục lục kèm lọc và phân trang limit/offset. */
  function adminTocsListPath(filters = {}, limit = ADMIN_TOC_DEFAULT_LIMIT, offset = 0) {
    const f = filters && typeof filters === 'object' ? filters : {};
    const params = new URLSearchParams();
    if (typeof f.auto_status === 'string' && f.auto_status.trim()) {
      params.set('auto_status', f.auto_status.trim());
    }
    if (typeof f.flag === 'string' && f.flag.trim()) {
      params.set('flag', f.flag.trim());
    }
    if (typeof f.job_status === 'string' && f.job_status.trim()) {
      params.set('job_status', f.job_status.trim());
    }
    if (f.manual_override === true || f.manual_override === 'true') {
      params.set('manual_override', 'true');
    } else if (f.manual_override === false || f.manual_override === 'false') {
      params.set('manual_override', 'false');
    }
    if (f.standards_only === true || f.standards_only === 'true') {
      params.set('standards_only', 'true');
    } else if (f.standards_only === false || f.standards_only === 'false') {
      params.set('standards_only', 'false');
    }
    if (f.outdated_algorithm === true || f.outdated_algorithm === 'true') {
      params.set('outdated_algorithm', 'true');
    }
    const safeLimit = Number.isInteger(Number(limit))
      ? Math.min(100, Math.max(1, Number(limit)))
      : ADMIN_TOC_DEFAULT_LIMIT;
    const safeOffset = Number.isInteger(Number(offset)) && Number(offset) >= 0 ? Number(offset) : 0;
    params.set('limit', String(safeLimit));
    params.set('offset', String(safeOffset));
    return `/admin/tocs?${params.toString()}`;
  }

  function adminFileTocPath(fileId) {
    const id = fileId !== undefined && fileId !== null ? String(fileId).trim() : '';
    if (!id) return null;
    return `/admin/files/${encodeURIComponent(id)}/toc`;
  }

  /** Ánh xạ thao tác admin TOC sang route + HTTP method + body đúng hợp đồng elib. */
  function adminTocActionRequest(action, fileId, payload) {
    const id = fileId !== undefined && fileId !== null ? String(fileId).trim() : '';
    if (!id) return null;
    const encId = encodeURIComponent(id);
    if (action === 'save') {
      return {
        method: 'PUT',
        path: `/admin/files/${encId}/toc/manual`,
        body: JSON.stringify(payload && typeof payload === 'object' ? payload : { nodes: [] })
      };
    }
    if (action === 'delete') {
      return {
        method: 'DELETE',
        path: `/admin/files/${encId}/toc/manual`,
        body: undefined
      };
    }
    if (action === 'promote') {
      return {
        method: 'POST',
        path: `/admin/files/${encId}/toc/promote-auto`,
        body: JSON.stringify(payload && typeof payload === 'object' ? payload : { activate: true })
      };
    }
    if (action === 'reextract') {
      return {
        method: 'POST',
        path: `/admin/files/${encId}/toc/reextract`,
        body: '{}'
      };
    }
    return null;
  }

  function adminTocTotalPages(detail) {
    const raw = detail?.page_count ?? detail?.auto_payload?.totalPages ?? null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }

  function canReextractToc(detail) {
    return Boolean(detail && typeof detail === 'object' && detail.file_id && detail.job_status !== 'processing');
  }

  /**
   * Khung xem thử PDF ở màn admin hiện chỉ dùng bản hiện hành (/view, dự phòng /preview)
   * vì elib chưa có route xem theo fileId riêng lẻ.
   */
  function adminTocPreviewPath(detail) {
    const docId = detail?.document_id ? String(detail.document_id).trim() : '';
    if (!docId) return null;
    const encDoc = encodeURIComponent(docId);
    return {
      url: `/api/elib/documents/${encDoc}/view`,
      fallbackUrl: `/api/elib/documents/${encDoc}/preview`,
      isCurrentVersion: detail.is_current_version === true
    };
  }

  /**
   * Kiểm tra cây mục lục thủ công phía client trước khi PUT:
   * - Cho phép nodes: [] (chủ động ẩn mục lục).
   * - Tiêu đề 1..200 ký tự (sau chuẩn hóa NFC + trim).
   * - Cấp (level) số nguyên 1..6.
   * - Trang (page_pdf) số nguyên trong 1..totalPages (khi đã biết totalPages).
   */
  function validateAdminTocNodes(nodes, totalPages, note = null) {
    if (!Array.isArray(nodes)) {
      return { ok: false, error: { key: 'adminTocErrInvalid' } };
    }
    if (nodes.length > ADMIN_TOC_MAX_NODES) {
      return { ok: false, error: { key: 'adminTocErrTooManyNodes', vars: { max: ADMIN_TOC_MAX_NODES } } };
    }
    let cleanNote = null;
    if (typeof note === 'string') {
      const trimmedNote = note.trim();
      if (trimmedNote.length > ADMIN_TOC_MAX_NOTE_LENGTH) {
        return { ok: false, error: { key: 'adminTocErrNoteTooLong', vars: { max: ADMIN_TOC_MAX_NOTE_LENGTH } } };
      }
      cleanNote = trimmedNote || null;
    }

    const validTotal = typeof totalPages === 'number' && Number.isInteger(totalPages) && totalPages >= 1
      ? totalPages
      : null;
    const normalized = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const row = nodes[i] && typeof nodes[i] === 'object' ? nodes[i] : {};
      const title = String(row.title ?? '').normalize('NFC').trim();
      if (title.length < 1) {
        return { ok: false, error: { key: 'adminTocErrTitleEmpty', vars: { index: i + 1 } } };
      }
      if (title.length > ADMIN_TOC_MAX_TITLE_LENGTH) {
        return {
          ok: false,
          error: { key: 'adminTocErrTitleTooLong', vars: { index: i + 1, max: ADMIN_TOC_MAX_TITLE_LENGTH } }
        };
      }
      const rawLevel = row.level;
      const level = typeof rawLevel === 'string' && rawLevel.trim() === '' ? NaN : Number(rawLevel);
      if (!Number.isInteger(level) || level < 1 || level > 6) {
        return { ok: false, error: { key: 'adminTocErrLevelRange', vars: { index: i + 1 } } };
      }
      const rawPage = row.page_pdf;
      const pagePdf = typeof rawPage === 'string' && rawPage.trim() === '' ? NaN : Number(rawPage);
      if (!Number.isInteger(pagePdf) || pagePdf < 1) {
        return { ok: false, error: { key: 'adminTocErrPageInvalid', vars: { index: i + 1 } } };
      }
      if (validTotal !== null && pagePdf > validTotal) {
        return {
          ok: false,
          error: { key: 'adminTocErrPageRange', vars: { index: i + 1, page: pagePdf, totalPages: validTotal } }
        };
      }
      normalized.push({ title, level, page_pdf: pagePdf });
    }
    return { ok: true, payload: { note: cleanNote, nodes: normalized } };
  }

  function adminTocMoveNode(nodes, index, delta) {
    if (!Array.isArray(nodes)) return [];
    const target = index + delta;
    if (index < 0 || index >= nodes.length || target < 0 || target >= nodes.length || target === index) {
      return nodes.slice();
    }
    const next = nodes.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    return next;
  }

  function adminTocInsertNode(nodes, index, template = {}) {
    const list = Array.isArray(nodes) ? nodes.slice() : [];
    const tpl = template && typeof template === 'object' ? template : {};
    const entry = {
      title: typeof tpl.title === 'string' ? tpl.title : '',
      level: Number.isInteger(Number(tpl.level)) ? Math.min(6, Math.max(1, Number(tpl.level))) : 1,
      page_pdf: Number.isInteger(Number(tpl.page_pdf)) && Number(tpl.page_pdf) >= 1 ? Number(tpl.page_pdf) : 1
    };
    const insertAt = typeof index === 'number' && index >= -1 && index < list.length ? index + 1 : list.length;
    list.splice(insertAt, 0, entry);
    return list;
  }

  function adminTocRemoveNode(nodes, index) {
    if (!Array.isArray(nodes) || index < 0 || index >= nodes.length) return Array.isArray(nodes) ? nodes.slice() : [];
    return nodes.filter((_, i) => i !== index);
  }

  function adminTocErrorKey(status, code) {
    if (status === 409 || code === 'TOC_ALREADY_PROCESSING' || code === 'JOB_PROCESSING') return 'adminTocErrProcessing';
    if (code === 'TOC_AUTO_NOT_AVAILABLE') return 'adminTocErrNoAuto';
    if (code === 'TOC_UNSUPPORTED_FORMAT') return 'adminTocErrUnsupported';
    if (code === 'INVALID_TOC_TITLE' || code === 'INVALID_TOC_NODES' || code === 'INVALID_PAGE_RANGE' || status === 400) {
      return 'adminTocErrInvalid';
    }
    if (status === 401) return 'adminErrLoginRequired';
    if (status === 403) return 'adminErrForbidden';
    if (status === 404) return 'adminTocErrNotFound';
    return 'adminTocErrFailed';
  }

  function formatAdminTocError(result, translate) {
    const status = result?.status ?? 0;
    const code = result?.errorCode || null;
    const serverMsg = typeof result?.payload?.error?.message === 'string' ? result.payload.error.message.trim() : '';
    if (serverMsg && (status === 400 || status === 403 || status === 404 || status === 409)) {
      return serverMsg;
    }
    const key = adminTocErrorKey(status, code);
    return typeof translate === 'function' ? translate(key) : key;
  }

  // ---- PDF in-document search core (S1) ----
  const PDF_SEARCH_MIN_QUERY_LENGTH = 2;
  const PDF_SEARCH_MAX_RESULTS = 2000;
  const PDF_SEARCH_SNIPPET_MAX_LENGTH = 120;
  const PDF_SEARCH_BATCH_SIZE = 4;
  const PDF_SEARCH_NO_TEXT_PROBE_PAGES = 10;

  function medianNumber(values, fallback) {
    if (!Array.isArray(values) || values.length === 0) return fallback;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function hasValidPdfTransform(transform) {
    if (!Array.isArray(transform) || transform.length < 6) return false;
    for (let i = 0; i < 6; i += 1) {
      if (typeof transform[i] !== 'number' || !Number.isFinite(transform[i])) return false;
    }
    return true;
  }

  function canUseGeometryLayout(indexedItems) {
    const nonEmpty = [];
    for (const entry of indexedItems) {
      if (entry.str.trim() === '') continue;
      if (!hasValidPdfTransform(entry.item?.transform)) return false;
      nonEmpty.push(entry);
    }
    if (nonEmpty.length === 0) return false;
    if (nonEmpty.length === 1) return true;
    const x0 = nonEmpty[0].item.transform[4];
    const y0 = nonEmpty[0].item.transform[5];
    for (let i = 1; i < nonEmpty.length; i += 1) {
      const t = nonEmpty[i].item.transform;
      if (t[4] !== x0 || t[5] !== y0) return true;
    }
    return false;
  }

  function buildPositionedItems(indexedItems) {
    const out = [];
    const spaceItems = [];
    for (const entry of indexedItems) {
      const t = entry.item.transform;
      if (!hasValidPdfTransform(t)) continue;
      const x0 = t[4];
      const y = t[5];
      const fontSize = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) ||
        (typeof entry.item.height === 'number' && Number.isFinite(entry.item.height) && entry.item.height > 0 ? entry.item.height : 10);
      const rawWidth = entry.item.width;
      const width = typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth >= 0
        ? rawWidth
        : entry.str.length * fontSize * 0.5;
      const box = {
        item: entry.item,
        str: entry.str,
        itemIndex: entry.itemIndex,
        x0,
        x1: x0 + width,
        y,
        fontSize
      };
      if (entry.str.trim() === '') {
        if (entry.str.length > 0) spaceItems.push(box);
      } else {
        out.push(box);
      }
    }
    return { positioned: out, spaceItems };
  }

  function clusterVisualRows(positioned) {
    const sorted = positioned.slice().sort((a, b) => {
      if (b.y !== a.y) return b.y - a.y;
      if (a.x0 !== b.x0) return a.x0 - b.x0;
      return a.itemIndex - b.itemIndex;
    });
    const rows = [];
    for (const box of sorted) {
      const last = rows[rows.length - 1];
      if (last) {
        const tolerance = Math.max(2, Math.min(last.fontSize, box.fontSize) * 0.48);
        if (Math.abs(box.y - last.anchorY) <= tolerance) {
          last.items.push(box);
          continue;
        }
      }
      rows.push({ anchorY: box.y, fontSize: box.fontSize, items: [box] });
    }
    for (const row of rows) {
      row.items.sort((a, b) => (a.x0 !== b.x0 ? a.x0 - b.x0 : a.itemIndex - b.itemIndex));
      row.y = row.anchorY;
      row.minX = row.items[0].x0;
      row.maxX = Math.max(...row.items.map(it => it.x1));
    }
    return rows;
  }

  function detectTwoColumnBlocks(rows, positioned, medianFontSize) {
    const fallbackBlocks = [{ kind: 'single', rows }];
    if (rows.length < 4 || positioned.length === 0) {
      return { twoColumnDetected: false, blocks: fallbackBlocks };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    for (const box of positioned) {
      if (box.x0 < minX) minX = box.x0;
      if (box.x1 > maxX) maxX = box.x1;
    }
    const spanX = maxX - minX;
    const minGutter = Math.max(12, medianFontSize * 1.4);
    if (!Number.isFinite(spanX) || spanX < 120) {
      return { twoColumnDetected: false, blocks: fallbackBlocks };
    }

    const lowSplit = minX + 0.32 * spanX;
    const highSplit = minX + 0.68 * spanX;
    const candidateMap = new Map();
    const addCandidate = (value) => {
      if (value < lowSplit || value > highSplit) return;
      const bucket = Math.round(value / 2) * 2;
      if (!candidateMap.has(bucket)) candidateMap.set(bucket, value);
    };

    for (const row of rows) {
      for (let i = 1; i < row.items.length; i += 1) {
        const prev = row.items[i - 1];
        const curr = row.items[i];
        if (curr.x0 - prev.x1 >= minGutter) {
          addCandidate((prev.x1 + curr.x0) / 2);
        }
      }
    }
    for (let k = 0; k <= 6; k += 1) {
      addCandidate(minX + (0.35 + k * 0.05) * spanX);
    }

    const pageCenterX = minX + spanX / 2;
    let bestPlan = null;

    for (const splitX of candidateMap.values()) {
      const classified = rows.map((row) => {
        let crosses = false;
        const left = [];
        const right = [];
        for (const it of row.items) {
          if (it.x0 < splitX - 2 && it.x1 > splitX + 2) {
            crosses = true;
            break;
          }
          const center = (it.x0 + it.x1) / 2;
          if (center <= splitX) {
            if (it.x1 > splitX + 2) { crosses = true; break; }
            left.push(it);
          } else {
            if (it.x0 < splitX - 2) { crosses = true; break; }
            right.push(it);
          }
        }
        if (crosses) return { row, type: 'full', left: [], right: [] };
        if (left.length > 0 && right.length > 0) {
          const leftMaxX1 = Math.max(...left.map(it => it.x1));
          const rightMinX0 = Math.min(...right.map(it => it.x0));
          if (rightMinX0 - leftMaxX1 < minGutter) {
            return { row, type: 'full', left: [], right: [] };
          }
          return { row, type: 'split', left, right };
        }
        if (left.length > 0) return { row, type: 'left', left, right: [] };
        return { row, type: 'right', left: [], right };
      });

      const bands = [];
      let totalTwoColRows = 0;
      let minQualifiedGutter = Infinity;
      let i = 0;
      while (i < classified.length) {
        if (classified[i].type === 'full') {
          const singleRows = [];
          while (i < classified.length && classified[i].type === 'full') {
            singleRows.push(classified[i].row);
            i += 1;
          }
          bands.push({ kind: 'single', rows: singleRows });
          continue;
        }
        const bandStart = i;
        while (i < classified.length && classified[i].type !== 'full') i += 1;
        const bandSlice = classified.slice(bandStart, i);
        const leftRows = [];
        const rightRows = [];
        let splitCount = 0;
        let bandLeftMinX0 = Infinity;
        let bandLeftMaxX1 = -Infinity;
        let bandRightMinX0 = Infinity;
        let bandRightMaxX1 = -Infinity;
        let leftMinY = Infinity;
        let leftMaxY = -Infinity;
        let rightMinY = Infinity;
        let rightMaxY = -Infinity;

        for (const item of bandSlice) {
          if (item.type === 'split') splitCount += 1;
          if (item.left.length > 0) {
            leftRows.push({ row: item.row, items: item.left });
            if (item.row.y < leftMinY) leftMinY = item.row.y;
            if (item.row.y > leftMaxY) leftMaxY = item.row.y;
            for (const bx of item.left) {
              if (bx.x0 < bandLeftMinX0) bandLeftMinX0 = bx.x0;
              if (bx.x1 > bandLeftMaxX1) bandLeftMaxX1 = bx.x1;
            }
          }
          if (item.right.length > 0) {
            rightRows.push({ row: item.row, items: item.right });
            if (item.row.y < rightMinY) rightMinY = item.row.y;
            if (item.row.y > rightMaxY) rightMaxY = item.row.y;
            for (const bx of item.right) {
              if (bx.x0 < bandRightMinX0) bandRightMinX0 = bx.x0;
              if (bx.x1 > bandRightMaxX1) bandRightMaxX1 = bx.x1;
            }
          }
        }

        const hasYOverlap = leftRows.length > 0 && rightRows.length > 0 &&
          Math.min(leftMaxY, rightMaxY) >= Math.max(leftMinY, rightMinY) - medianFontSize * 1.5;
        const bandGutter = bandRightMinX0 - bandLeftMaxX1;
        const leftWidth = bandLeftMaxX1 - bandLeftMinX0;
        const rightWidth = bandRightMaxX1 - bandRightMinX0;

        const qualified = leftRows.length >= 2 &&
          rightRows.length >= 2 &&
          (hasYOverlap || splitCount >= 2) &&
          bandGutter >= minGutter &&
          leftWidth >= spanX * 0.18 &&
          rightWidth >= spanX * 0.18;

        if (qualified) {
          totalTwoColRows += bandSlice.length;
          if (bandGutter < minQualifiedGutter) minQualifiedGutter = bandGutter;
          bands.push({
            kind: 'two-col',
            left: leftRows,
            right: rightRows
          });
        } else {
          bands.push({ kind: 'single', rows: bandSlice.map(entry => entry.row) });
        }
      }

      if (totalTwoColRows === 0) continue;
      const distCenter = Math.abs(splitX - pageCenterX);
      const isBetter = !bestPlan ||
        totalTwoColRows > bestPlan.totalTwoColRows ||
        (totalTwoColRows === bestPlan.totalTwoColRows && (
          minQualifiedGutter > bestPlan.minQualifiedGutter ||
          (minQualifiedGutter === bestPlan.minQualifiedGutter && distCenter < bestPlan.distCenter)
        ));
      if (isBetter) {
        bestPlan = { totalTwoColRows, minQualifiedGutter, distCenter, bands };
      }
    }

    if (!bestPlan) {
      return { twoColumnDetected: false, blocks: fallbackBlocks };
    }

    const blocks = [];
    for (const band of bestPlan.bands) {
      if (band.kind === 'two-col') {
        blocks.push({ kind: 'col', rows: band.left.map(entry => ({ items: entry.items })) });
        blocks.push({ kind: 'col', rows: band.right.map(entry => ({ items: entry.items })) });
      } else {
        blocks.push({ kind: 'single', rows: band.rows });
      }
    }
    return { twoColumnDetected: true, blocks };
  }

  function buildGeometryLine(items, spaceItems) {
    let chars = '';
    const spans = [];
    let prev = null;
    for (const curr of items) {
      if (prev) {
        const spaceThreshold = Math.max(1.5, Math.min(prev.fontSize, curr.fontSize) * 0.18);
        const gap = curr.x0 - prev.x1;
        const needsGapSpace = gap > spaceThreshold && !/\s$/u.test(chars) && !/^\s/u.test(curr.str);
        let hasBetweenSpaceItem = false;
        if (!needsGapSpace && !/\s$/u.test(chars) && !/^\s/u.test(curr.str) && spaceItems.length > 0) {
          const tol = Math.max(2, Math.min(prev.fontSize, curr.fontSize) * 0.48);
          for (const sp of spaceItems) {
            if (Math.abs(sp.y - prev.y) <= tol &&
              sp.itemIndex > prev.itemIndex &&
              sp.itemIndex < curr.itemIndex &&
              sp.x0 >= prev.x0 - 1 &&
              sp.x0 <= curr.x0 + 1) {
              hasBetweenSpaceItem = true;
              break;
            }
          }
        }
        if (needsGapSpace || hasBetweenSpaceItem) {
          chars += ' ';
        }
      }
      if (curr.str.length > 0) {
        const startInLine = chars.length;
        chars += curr.str;
        spans.push({
          startInLine,
          endInLine: chars.length,
          itemIndex: curr.itemIndex,
          itemStart: 0
        });
      }
      prev = curr;
    }
    return { chars, spans };
  }

  function mergeBlockLines(lines) {
    let buf = '';
    const blockSpans = [];

    const popLastChar = () => {
      if (buf.length === 0) return;
      const newLen = buf.length - 1;
      buf = buf.slice(0, newLen);
      while (blockSpans.length > 0 && blockSpans[blockSpans.length - 1].rawStart >= newLen) {
        blockSpans.pop();
      }
      if (blockSpans.length > 0 && blockSpans[blockSpans.length - 1].rawEnd > newLen) {
        blockSpans[blockSpans.length - 1].rawEnd = newLen;
      }
    };

    const appendLine = (line, skipLeadingChars = 0) => {
      const base = buf.length;
      const text = skipLeadingChars > 0 ? line.chars.slice(skipLeadingChars) : line.chars;
      buf += text;
      for (const s of line.spans) {
        if (s.endInLine <= skipLeadingChars) continue;
        const adjStart = Math.max(s.startInLine, skipLeadingChars);
        const trimDelta = adjStart - s.startInLine;
        blockSpans.push({
          rawStart: base + (adjStart - skipLeadingChars),
          rawEnd: base + (s.endInLine - skipLeadingChars),
          itemIndex: s.itemIndex,
          itemStart: s.itemStart + trimDelta
        });
      }
    };

    for (const line of lines) {
      if (buf.length === 0) {
        appendLine(line, 0);
        continue;
      }
      const trimmedBuf = buf.replace(/[ \t]+$/g, '');
      const trimmedNext = line.chars.replace(/^[ \t]+/g, '');
      const leadWs = line.chars.length - trimmedNext.length;

      if (trimmedNext.length > 0 && /\p{L}\u00AD$/u.test(trimmedBuf) && /^\p{L}/u.test(trimmedNext)) {
        while (buf.length > trimmedBuf.length - 1) popLastChar();
        appendLine(line, leadWs);
      } else if (trimmedNext.length > 0 && /\p{L}[-\u2010]$/u.test(trimmedBuf) && /^\p{Ll}/u.test(trimmedNext)) {
        while (buf.length > trimmedBuf.length - 1) popLastChar();
        appendLine(line, leadWs);
      } else if (trimmedNext.length > 0 && /[\p{L}\d][-\u2010]$/u.test(trimmedBuf) && /^[\p{Lu}\d]/u.test(trimmedNext)) {
        while (buf.length > trimmedBuf.length) popLastChar();
        appendLine(line, leadWs);
      } else {
        buf += '\n';
        appendLine(line, 0);
      }
    }

    return { text: buf, spans: blockSpans };
  }

  function joinBlocksToPage(blockEntries) {
    let rawText = '';
    const itemSpans = [];
    for (const block of blockEntries) {
      if (!block || !block.text) continue;
      if (rawText.length > 0) rawText += '\n';
      const offset = rawText.length;
      rawText += block.text;
      for (const span of block.spans) {
        itemSpans.push({
          rawStart: offset + span.rawStart,
          rawEnd: offset + span.rawEnd,
          itemIndex: span.itemIndex,
          itemStart: span.itemStart
        });
      }
    }
    const nonSpaceCount = rawText.replace(/[\s\u200B-\u200D\uFEFF\u00AD]/g, '').length;
    return { rawText, itemSpans, nonSpaceCount };
  }

  /**
   * Trích text và bảng ánh xạ về textContent item gốc cho 1 trang PDF:
   * - Duy trì đúng chỉ số itemIndex như pdf.js TextLayer (tăng cho mọi item có str là chuỗi, kể cả "").
   * - Suy luận dòng theo tọa độ (hoặc theo hasEOL nếu không có transform), xử lý gạch nối cuối dòng
   *   và tách hai cột đọc độc lập khi phát hiện khe cột rõ ràng.
   */
  function extractPageText(textContent) {
    const rawItems = Array.isArray(textContent?.items) ? textContent.items : [];
    const indexedItems = [];
    let nextItemIndex = 0;
    for (const item of rawItems) {
      if (typeof item?.str === 'string') {
        indexedItems.push({ item, str: item.str, itemIndex: nextItemIndex });
        nextItemIndex += 1;
      }
    }
    if (indexedItems.length === 0) {
      return { rawText: '', itemSpans: [], nonSpaceCount: 0, twoColumnDetected: false };
    }

    if (!canUseGeometryLayout(indexedItems)) {
      const lines = [];
      let currentLine = { chars: '', spans: [] };
      for (const entry of indexedItems) {
        if (entry.str.length > 0) {
          const startInLine = currentLine.chars.length;
          currentLine.chars += entry.str;
          currentLine.spans.push({
            startInLine,
            endInLine: currentLine.chars.length,
            itemIndex: entry.itemIndex,
            itemStart: 0
          });
        }
        if (entry.item?.hasEOL) {
          if (currentLine.chars.length > 0 || lines.length === 0) {
            lines.push(currentLine);
          }
          currentLine = { chars: '', spans: [] };
        }
      }
      if (currentLine.chars.length > 0) lines.push(currentLine);
      const nonEmptyLines = lines.filter(line => line.chars.length > 0);
      const merged = nonEmptyLines.length > 0 ? [mergeBlockLines(nonEmptyLines)] : [];
      return { ...joinBlocksToPage(merged), twoColumnDetected: false };
    }

    const { positioned, spaceItems } = buildPositionedItems(indexedItems);
    if (positioned.length === 0) {
      return { rawText: '', itemSpans: [], nonSpaceCount: 0, twoColumnDetected: false };
    }
    const medianFontSize = medianNumber(positioned.map(p => p.fontSize), 10);
    const rows = clusterVisualRows(positioned);
    const layout = detectTwoColumnBlocks(rows, positioned, medianFontSize);
    const blockEntries = [];
    for (const block of layout.blocks) {
      const lines = block.rows
        .map(row => buildGeometryLine(row.items, spaceItems))
        .filter(line => line.chars.length > 0);
      if (lines.length > 0) {
        blockEntries.push(mergeBlockLines(lines));
      }
    }
    return {
      ...joinBlocksToPage(blockEntries),
      twoColumnDetected: layout.twoColumnDetected
    };
  }

  /**
   * Chuẩn hóa chuỗi nguồn để tìm kiếm (NFC, tùy chọn caseSensitive / ignoreDiacritics kể cả đ/Đ),
   * đồng thời giữ Uint32Array ánh xạ từng code unit chuẩn hóa -> [rawStart, rawEnd) trên rawText gốc.
   */
  function normalizeSearchTextWithMap(rawText, options = {}) {
    const str = String(rawText ?? '');
    const caseSensitive = options.caseSensitive === true;
    const ignoreDiacritics = options.ignoreDiacritics !== false;
    const normChars = [];
    const starts = [];
    const ends = [];

    let i = 0;
    while (i < str.length) {
      const cp = str.codePointAt(i);
      const step = cp > 0xffff ? 2 : 1;
      const ch = str.slice(i, i + step);

      if (cp === 0x00ad || cp === 0xfeff || (cp >= 0x200b && cp <= 0x200d)) {
        i += step;
        continue;
      }

      if (/\s/u.test(ch)) {
        const wsStart = i;
        i += step;
        while (i < str.length) {
          const nextCp = str.codePointAt(i);
          const nextStep = nextCp > 0xffff ? 2 : 1;
          const nextCh = str.slice(i, i + nextStep);
          if (!/\s/u.test(nextCh)) break;
          i += nextStep;
        }
        const wsEnd = i;
        if (normChars.length > 0 && normChars[normChars.length - 1] === ' ') {
          ends[ends.length - 1] = wsEnd;
        } else {
          normChars.push(' ');
          starts.push(wsStart);
          ends.push(wsEnd);
        }
        continue;
      }

      const clusterStart = i;
      i += step;
      while (i < str.length) {
        const nextCp = str.codePointAt(i);
        const nextStep = nextCp > 0xffff ? 2 : 1;
        if (!/\p{M}/u.test(String.fromCodePoint(nextCp))) break;
        i += nextStep;
      }
      const clusterEnd = i;

      let piece = str.slice(clusterStart, clusterEnd).normalize('NFC');
      if (!caseSensitive) {
        piece = piece.toLowerCase();
      }
      if (ignoreDiacritics) {
        piece = piece
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/Đ/g, 'D')
          .normalize('NFC');
      }
      for (let k = 0; k < piece.length; k += 1) {
        normChars.push(piece[k]);
        starts.push(clusterStart);
        ends.push(clusterEnd);
      }
    }

    return {
      text: normChars.join(''),
      rawStarts: Uint32Array.from(starts),
      rawEnds: Uint32Array.from(ends)
    };
  }

  function normalizeSearchQuery(query, options = {}) {
    return normalizeSearchTextWithMap(String(query ?? ''), options).text.trim();
  }

  /**
   * Ánh xạ khoảng [rawStart, rawEnd) trên rawText về danh sách đoạn { itemIndex, start, end }
   * trong page.getTextContent().items (tìm kiếm nhị phân O(log K)).
   */
  function mapRawRangeToItemRanges(itemSpans, rawStart, rawEnd) {
    if (!Array.isArray(itemSpans) || itemSpans.length === 0 || !(rawEnd > rawStart)) return [];
    let lo = 0;
    let hi = itemSpans.length - 1;
    let first = itemSpans.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (itemSpans[mid].rawEnd > rawStart) {
        first = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const ranges = [];
    for (let i = first; i < itemSpans.length; i += 1) {
      const seg = itemSpans[i];
      if (seg.rawStart >= rawEnd) break;
      const overlapStart = Math.max(rawStart, seg.rawStart);
      const overlapEnd = Math.min(rawEnd, seg.rawEnd);
      if (overlapEnd > overlapStart) {
        ranges.push({
          itemIndex: seg.itemIndex,
          start: seg.itemStart + (overlapStart - seg.rawStart),
          end: seg.itemStart + (overlapEnd - seg.rawStart)
        });
      }
    }
    return ranges;
  }

  /**
   * Tạo đoạn trích thuần chữ { prefix, match, suffix, text } (<= maxLength) không chứa HTML
   * để giao diện tô đậm an toàn bằng DOM textContent.
   */
  function buildMatchSnippet(rawText, rawStart, rawEnd, maxLength = PDF_SEARCH_SNIPPET_MAX_LENGTH) {
    const str = String(rawText ?? '');
    const limit = Math.max(8, Math.trunc(Number(maxLength) || PDF_SEARCH_SNIPPET_MAX_LENGTH));
    const safeStart = Math.max(0, Math.min(str.length, Math.trunc(Number(rawStart) || 0)));
    const safeEnd = Math.max(safeStart, Math.min(str.length, Math.trunc(Number(rawEnd) || safeStart)));

    const rawMatchSlice = str.slice(safeStart, safeEnd).replace(/\s+/g, ' ').trim();
    const matchText = rawMatchSlice || str.slice(safeStart, safeEnd);
    if (matchText.length > limit) {
      const clipped = matchText.slice(0, Math.max(1, limit - 1)) + '…';
      return { prefix: '', match: clipped, suffix: '', text: clipped };
    }
    if (matchText.length === limit) {
      return { prefix: '', match: matchText, suffix: '', text: matchText };
    }

    const pad = Math.max(80, limit + 40);
    const sliceStart = Math.max(0, safeStart - pad);
    const sliceEnd = Math.min(str.length, safeEnd + pad);
    const beforeClean = str.slice(sliceStart, safeStart).replace(/\s+/g, ' ').replace(/^\s+/, '');
    const afterClean = str.slice(safeEnd, sliceEnd).replace(/\s+/g, ' ').replace(/\s+$/, '');

    const budget = limit - matchText.length;
    let prefixBudget = Math.min(beforeClean.length + (sliceStart > 0 ? 1 : 0), Math.floor(budget * 0.4));
    const desiredSuffix = afterClean.length + (sliceEnd < str.length ? 1 : 0);
    if (desiredSuffix < budget - prefixBudget) {
      prefixBudget = Math.min(beforeClean.length + (sliceStart > 0 ? 1 : 0), budget - desiredSuffix);
    }

    const needLeftEllipsis = sliceStart > 0 || beforeClean.length > prefixBudget;
    let prefix = '';
    if (prefixBudget > 0) {
      if (!needLeftEllipsis) {
        prefix = beforeClean;
      } else if (beforeClean.length === 0) {
        prefix = '…';
      } else if (prefixBudget === 1) {
        prefix = '…';
      } else {
        const innerMax = prefixBudget - 1;
        let sub = beforeClean.length > innerMax ? beforeClean.slice(beforeClean.length - innerMax) : beforeClean;
        if (beforeClean.length > innerMax) {
          const spIdx = sub.indexOf(' ');
          if (spIdx > 0 && spIdx <= Math.min(12, sub.length - 4)) {
            sub = sub.slice(spIdx + 1);
          }
        }
        prefix = `…${sub}`;
      }
    }

    const suffixBudget = budget - prefix.length;
    const needRightEllipsis = sliceEnd < str.length || afterClean.length > suffixBudget;
    let suffix = '';
    if (suffixBudget > 0) {
      if (!needRightEllipsis) {
        suffix = afterClean;
      } else if (afterClean.length === 0) {
        suffix = '…';
      } else if (suffixBudget === 1) {
        suffix = '…';
      } else {
        const innerMax = suffixBudget - 1;
        let sub = afterClean.length > innerMax ? afterClean.slice(0, innerMax) : afterClean;
        if (afterClean.length > innerMax) {
          const spIdx = sub.lastIndexOf(' ');
          if (spIdx >= Math.max(4, sub.length - 12)) {
            sub = sub.slice(0, spIdx);
          }
        }
        suffix = `${sub}…`;
      }
    }

    return {
      prefix,
      match: matchText,
      suffix,
      text: `${prefix}${matchText}${suffix}`
    };
  }

  function searchPageText(pageEntry, normQuery, options = {}) {
    if (!pageEntry || !pageEntry.rawText || typeof normQuery !== 'string' || normQuery.length < PDF_SEARCH_MIN_QUERY_LENGTH) {
      return { matches: [], truncated: false };
    }
    const maxResults = Math.max(0, Math.trunc(options.maxResults ?? PDF_SEARCH_MAX_RESULTS));
    if (maxResults === 0) return { matches: [], truncated: false };

    const caseSensitive = options.caseSensitive === true;
    const ignoreDiacritics = options.ignoreDiacritics !== false;
    const snippetMaxLength = options.snippetMaxLength ?? PDF_SEARCH_SNIPPET_MAX_LENGTH;
    const modeKey = `${caseSensitive ? 1 : 0}:${ignoreDiacritics ? 1 : 0}`;
    if (!pageEntry.normCache || pageEntry.normCache.modeKey !== modeKey) {
      pageEntry.normCache = {
        modeKey,
        ...normalizeSearchTextWithMap(pageEntry.rawText, { caseSensitive, ignoreDiacritics })
      };
    }

    const { text: haystack, rawStarts, rawEnds } = pageEntry.normCache;
    if (!haystack) return { matches: [], truncated: false };

    const matches = [];
    let pos = 0;
    let truncated = false;
    while (pos <= haystack.length - normQuery.length) {
      const idx = haystack.indexOf(normQuery, pos);
      if (idx === -1) break;
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }
      const rawStart = rawStarts[idx];
      const rawEnd = rawEnds[idx + normQuery.length - 1];
      const pageMatchIndex = matches.length;
      matches.push({
        id: `${pageEntry.pageNum}-${pageMatchIndex}`,
        pageNum: pageEntry.pageNum,
        pageMatchIndex,
        rawStart,
        rawEnd,
        itemRanges: mapRawRangeToItemRanges(pageEntry.itemSpans, rawStart, rawEnd),
        snippet: buildMatchSnippet(pageEntry.rawText, rawStart, rawEnd, snippetMaxLength)
      });
      pos = idx + normQuery.length;
    }

    return { matches, truncated };
  }

  /**
   * Bộ lập chỉ mục nền theo lô nhỏ và tìm kiếm trong PDF đang mở.
   * Dừng ngay khi đủ N trang đầu không có lớp chữ (no_text_layer) hoặc khi cancel().
   */
  function createPdfSearchEngine(config = {}) {
    const pdf = config.pdf || null;
    const batchSize = Math.max(1, Math.trunc(Number(config.batchSize) || PDF_SEARCH_BATCH_SIZE));
    const noTextProbePages = Math.max(1, Math.trunc(Number(config.noTextProbePages) || PDF_SEARCH_NO_TEXT_PROBE_PAGES));
    const maxResults = Math.max(1, Math.trunc(Number(config.maxResults) || PDF_SEARCH_MAX_RESULTS));
    const snippetMaxLength = Math.max(8, Math.trunc(Number(config.snippetMaxLength) || PDF_SEARCH_SNIPPET_MAX_LENGTH));
    const yieldToMain = typeof config.yieldToMain === 'function'
      ? config.yieldToMain
      : () => new Promise(resolve => setTimeout(resolve, 0));
    const onUpdate = typeof config.onUpdate === 'function' ? config.onUpdate : null;

    const totalPages = Math.max(0, Math.trunc(Number(pdf?.numPages) || 0));
    const probeLimit = Math.min(totalPages, noTextProbePages);
    const pageCache = new Map();

    let status = 'idle';
    let indexedPages = 0;
    let totalNonSpaceChars = 0;
    let hasTextLayer = null;
    let query = '';
    let normQuery = '';
    let queryTooShort = false;
    let searchOptions = { caseSensitive: false, ignoreDiacritics: true };
    let matches = [];
    let truncated = false;
    let cancelled = false;
    let queryGeneration = 0;
    let searchedUpToPage = 0;
    let indexPromise = null;

    const getSnapshot = () => ({
      status,
      indexedPages,
      totalPages,
      hasTextLayer,
      query,
      normQuery,
      queryTooShort,
      options: { ...searchOptions },
      matches: matches.slice(),
      totalMatches: matches.length,
      truncated
    });

    const emit = () => {
      if (cancelled || !onUpdate) return;
      onUpdate(getSnapshot());
    };

    const scanCachedRange = (fromPage, toPage) => {
      if (!normQuery || normQuery.length < PDF_SEARCH_MIN_QUERY_LENGTH || status === 'no_text_layer') return;
      for (let p = fromPage; p <= toPage; p += 1) {
        if (truncated || matches.length >= maxResults) {
          truncated = true;
          break;
        }
        const entry = pageCache.get(p);
        if (!entry) break;
        const remaining = maxResults - matches.length;
        const res = searchPageText(entry, normQuery, {
          ...searchOptions,
          maxResults: remaining,
          snippetMaxLength
        });
        for (const match of res.matches) {
          matches.push(match);
        }
        if (res.truncated) {
          truncated = true;
        }
        searchedUpToPage = p;
      }
    };

    const startIndexing = () => {
      if (cancelled) return Promise.resolve(getSnapshot());
      if (status === 'ready' || status === 'no_text_layer') {
        return Promise.resolve(getSnapshot());
      }
      if (indexPromise) return indexPromise;
      if (!pdf || totalPages === 0 || typeof pdf.getPage !== 'function') {
        status = 'no_text_layer';
        hasTextLayer = false;
        emit();
        return Promise.resolve(getSnapshot());
      }

      status = 'indexing';
      indexPromise = (async () => {
        let nextPage = 1;
        while (nextPage <= totalPages && !cancelled && status === 'indexing') {
          let processedInBatch = 0;
          while (processedInBatch < batchSize && nextPage <= totalPages && !cancelled) {
            const pageNum = nextPage;
            nextPage += 1;
            if (!pageCache.has(pageNum)) {
              let extracted;
              try {
                const page = await pdf.getPage(pageNum);
                if (cancelled) return getSnapshot();
                const textContent = typeof page?.getTextContent === 'function'
                  ? await page.getTextContent()
                  : { items: [] };
                if (cancelled) return getSnapshot();
                extracted = extractPageText(textContent);
              } catch {
                if (cancelled) return getSnapshot();
                extracted = { rawText: '', itemSpans: [], nonSpaceCount: 0, twoColumnDetected: false };
              }
              pageCache.set(pageNum, {
                pageNum,
                rawText: extracted.rawText,
                itemSpans: extracted.itemSpans,
                nonSpaceCount: extracted.nonSpaceCount,
                twoColumnDetected: extracted.twoColumnDetected,
                normCache: null
              });
              totalNonSpaceChars += extracted.nonSpaceCount;
              if (totalNonSpaceChars > 0) hasTextLayer = true;
            }
            if (pageNum > indexedPages) indexedPages = pageNum;
            processedInBatch += 1;

            if (probeLimit > 0 && pageNum >= probeLimit && totalNonSpaceChars === 0) {
              status = 'no_text_layer';
              hasTextLayer = false;
              matches = [];
              truncated = false;
              searchedUpToPage = indexedPages;
              emit();
              return getSnapshot();
            }
          }

          if (cancelled) return getSnapshot();
          const gen = queryGeneration;
          if (normQuery.length >= PDF_SEARCH_MIN_QUERY_LENGTH && !truncated && indexedPages > searchedUpToPage) {
            scanCachedRange(searchedUpToPage + 1, indexedPages);
          }
          if (cancelled || queryGeneration !== gen) {
            if (cancelled) return getSnapshot();
          }

          if (nextPage > totalPages) {
            status = totalNonSpaceChars === 0 ? 'no_text_layer' : 'ready';
            hasTextLayer = totalNonSpaceChars > 0;
            if (status === 'no_text_layer') {
              matches = [];
              truncated = false;
            }
            emit();
            return getSnapshot();
          }

          emit();
          await yieldToMain();
          if (cancelled) return getSnapshot();
        }
        return getSnapshot();
      })();

      return indexPromise;
    };

    const setQuery = (nextQuery, nextOptions = {}) => {
      if (cancelled) return getSnapshot();
      queryGeneration += 1;
      query = typeof nextQuery === 'string' ? nextQuery : String(nextQuery ?? '');
      searchOptions = {
        caseSensitive: nextOptions.caseSensitive === true,
        ignoreDiacritics: nextOptions.ignoreDiacritics !== false
      };
      normQuery = normalizeSearchQuery(query, searchOptions);
      queryTooShort = query.trim().length > 0 && normQuery.length < PDF_SEARCH_MIN_QUERY_LENGTH;
      matches = [];
      truncated = false;
      searchedUpToPage = 0;

      if (status === 'no_text_layer') {
        emit();
        return getSnapshot();
      }
      if (normQuery.length < PDF_SEARCH_MIN_QUERY_LENGTH) {
        emit();
        return getSnapshot();
      }

      if (indexedPages > 0) {
        scanCachedRange(1, indexedPages);
      }
      emit();
      if (status === 'idle') {
        void startIndexing();
      }
      return getSnapshot();
    };

    const clearQuery = () => {
      if (cancelled) return getSnapshot();
      queryGeneration += 1;
      query = '';
      normQuery = '';
      queryTooShort = false;
      matches = [];
      truncated = false;
      searchedUpToPage = 0;
      emit();
      return getSnapshot();
    };

    const cancel = () => {
      cancelled = true;
      status = 'cancelled';
    };

    const estimateMemoryBytes = () => {
      let bytes = 0;
      for (const entry of pageCache.values()) {
        bytes += (entry.rawText ? entry.rawText.length * 2 : 0);
        bytes += (entry.itemSpans ? entry.itemSpans.length * 32 : 0);
        if (entry.normCache) {
          bytes += (entry.normCache.text ? entry.normCache.text.length * 2 : 0);
          bytes += entry.normCache.rawStarts ? entry.normCache.rawStarts.byteLength : 0;
          bytes += entry.normCache.rawEnds ? entry.normCache.rawEnds.byteLength : 0;
        }
      }
      return bytes;
    };

    return {
      startIndexing,
      setQuery,
      clearQuery,
      cancel,
      getSnapshot,
      getPageCache: pageNum => pageCache.get(pageNum),
      estimateMemoryBytes
    };
  }

  const fileHelpers = { fileKindFromName, needsLoginForDoc, formatFileSize, elibDownloadPath, elibPreviewPath, elibViewPath, previewAffordance, previewErrorKey, downloadAffordance, viewerToolbar, downloadErrorKey, filenameFromDisposition, endOfPreviewKind, previewStateKey, parseDocDeepLink, docDeepLinkHash, canChangeVisibility, visibilityErrorKey, normalizeContact, passwordPairErrorKey, validateRegistration, registerErrorKey, loginErrorKey, changePasswordErrorKey, adminErrorKey, isAdminUser, roleOptionsForUser, canUploadStandardFile, standardFilesPath, standardFileState, buildStandardFileDoc, codeCheckWarningKey, standardUploadErrorKey, summaryMatchesCode, buildSummaryDetail, resolveSummaryFallback, adminStandardPath, canEditStandardMetadata, parseIcsInput, formatIcsInput, normalizeDateInput, buildManualPrefill, buildManualSavePayload, manualSaveErrorKey, TOC_POLL_INTERVAL_MS, TOC_POLL_MAX_RETRIES, elibTocPath, resolveTocViewState, shouldPollToc, tocFooterKeys, buildTocTree, normalizeTocSearchText, filterTocTree, findActiveTocNodeId, tocNodeClickAction, createTocListDom, ADMIN_TOC_MAX_NODES, ADMIN_TOC_MAX_TITLE_LENGTH, ADMIN_TOC_MAX_NOTE_LENGTH, ADMIN_TOC_DEFAULT_LIMIT, canManageAdminTocs, adminTocsListPath, adminFileTocPath, adminTocActionRequest, adminTocTotalPages, canReextractToc, adminTocPreviewPath, validateAdminTocNodes, adminTocMoveNode, adminTocInsertNode, adminTocRemoveNode, adminTocErrorKey, formatAdminTocError, PDF_SEARCH_MIN_QUERY_LENGTH, PDF_SEARCH_MAX_RESULTS, PDF_SEARCH_SNIPPET_MAX_LENGTH, PDF_SEARCH_BATCH_SIZE, PDF_SEARCH_NO_TEXT_PROBE_PAGES, extractPageText, normalizeSearchTextWithMap, normalizeSearchQuery, mapRawRangeToItemRanges, buildMatchSnippet, searchPageText, createPdfSearchEngine };

  if (typeof document === 'undefined') {
    globalThis.__vsqiDetailModel = detailModel;
    globalThis.__smartrailFileHelpers = fileHelpers;
    return;
  }


  function initApp() {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const DASH = '—';
    const memory = { search: null, detail: null };
    let toastTimer;
    let currentLang = 'vi';
    try { currentLang = localStorage.getItem('smartrail-lang') === 'en' ? 'en' : 'vi'; } catch { currentLang = 'vi'; }

    const I18N = {
      vi: {
        navHome: 'Trang chủ', navSearch: 'Tìm kiếm', navCategories: 'Danh mục', navDocuments: 'Tài liệu', navLibrary: 'Thư viện cá nhân',
        login: 'Đăng nhập', loginNote: 'Đăng nhập tại mục Tài liệu để tải lên và quản lý tài liệu của thư viện.',
        heroTitle: 'Thư viện tri thức Đường sắt & TOD', heroSubtitle: 'Khám phá, tra cứu và khai thác nguồn tài liệu chuyên ngành.',
        heroSearchLabel: 'Tìm kiếm tài liệu', heroPlaceholder: 'Tìm kiếm tài liệu, tiêu chuẩn, dự án...', search: 'Tìm kiếm',
        heroHint: 'Tìm theo tên, mã tiêu chuẩn hoặc từ khóa. Dữ liệu được tra cứu trực tiếp từ VSQI và tracuu.tcvn.vn.',
        disciplines: 'Danh mục chuyên ngành', discRail: 'Đường sắt', discWorks: 'Công trình', discElectric: 'Điện – Điện tử', discSignal: 'Tín hiệu', discDigital: 'Công nghệ số', discTod: 'TOD & Mobility',
        recentDocs: 'Tài liệu mới cập nhật', seeAll: 'Xem tất cả', recentNote: 'Các file mới nhất được tải lên thư viện số (elib), mới nhất trước.',
        featuredCollections: 'Bộ sưu tập nổi bật', collectionsNote: 'Các bộ sưu tập là lối tắt tìm kiếm theo chủ đề; kết quả luôn được tra cứu trực tiếp từ API.',
        colRail: 'Tiêu chuẩn đường sắt', colRailDesc: 'Tra cứu tiêu chuẩn, quy chuẩn về đường sắt', colSafety: 'An toàn đường sắt', colSafetyDesc: 'Tài liệu về an toàn vận hành và khai thác',
        colBim: 'BIM & công nghệ số', colBimDesc: 'Mô hình thông tin và chuyển đổi số', colTod: 'TOD & quy hoạch', colTodDesc: 'Phát triển đô thị gắn với giao thông công cộng',
        colQuality: 'Quản lý chất lượng', colQualityDesc: 'Hệ thống quản lý chất lượng ISO', colWater: 'Công trình thủy lợi', colWaterDesc: 'Tiêu chuẩn công trình thủy lợi',
        searchTitle: 'Tìm kiếm tài liệu', searchSubtitle: 'Tra cứu nhanh các tài liệu, tiêu chuẩn và ấn phẩm chuyên ngành từ VSQI và tracuu.tcvn.vn.',
        keyword: 'Từ khóa', searchPlaceholder: 'Nhập từ khóa cần tìm (ví dụ: tiêu chuẩn đường sắt, BIM, TOD...)', try: 'Thử:', advanced: 'Tìm kiếm nâng cao',
        advSource: 'Nguồn dữ liệu', allSources: 'Tất cả nguồn', advYear: 'Năm phát hành', advOrg: 'Tổ chức / loại tài liệu', advOrgPlaceholder: 'Ví dụ: ISO, TCVN, QCVN...',
        advancedNote: 'Tìm kiếm nâng cao bổ sung từ khóa vào truy vấn; nguồn và năm được lọc trên kết quả trả về (phía trình duyệt).',
        filters: 'Bộ lọc kết quả', clearFilters: 'Xóa tất cả', filterSource: 'Nguồn', filterYear: 'Năm', filterStatus: 'Tình trạng',
        allStatuses: 'Tất cả', statusActive: 'Còn hiệu lực', statusWithdrawn: 'Hết hiệu lực',
        filterNote: 'Bộ lọc áp dụng trên trang kết quả hiện tại (phía trình duyệt). API chỉ nhận từ khóa và số trang.',
        awaiting: 'Chưa có truy vấn', sort: 'Sắp xếp:', sortRelevance: 'Liên quan nhất', sortNewest: 'Mới nhất', sortTitle: 'Tên A–Z',
        listView: 'Danh sách', gridView: 'Lưới', emptyTitle: 'Sẵn sàng tra cứu', emptyText: 'Nhập từ khóa ở trên để tìm tiêu chuẩn từ VSQI và tracuu.tcvn.vn.',
        prevPage: 'Trang trước', nextPage: 'Trang sau', pagingNote: 'Phân trang áp dụng riêng cho từng nguồn dữ liệu.',
        copyUrl: 'Sao chép URL', httpStatus: 'HTTP', responseTime: 'Thời gian', rawJson: 'Raw JSON', copyJson: 'Sao chép JSON',
        categoriesTitle: 'Danh mục chuyên ngành', categoriesSubtitle: 'Khám phá kho tri thức theo lĩnh vực chuyên môn. Số lượng tài liệu được tra cứu trực tiếp từ API theo từ khóa của từng danh mục.',
        categoriesNote: 'Hệ thống hiện chưa có taxonomy riêng; mỗi danh mục là một truy vấn tìm kiếm theo chủ đề trên API hiện có.',
        detailCodeLabel: 'Số hiệu tiêu chuẩn', detailSourceLabel: 'Nguồn', autoSource: 'Tự động (VSQI → VN → QT)', getDetail: 'Xem chi tiết',
        detailEmptyTitle: 'Chưa chọn tài liệu', detailEmptyText: 'Nhập số hiệu ở trên hoặc chọn một kết quả từ tìm kiếm.',
        coverKind: 'TIÊU CHUẨN', viewAtSource: 'Xem tại nguồn gốc', preview: 'Xem trước thông tin', saveLibrary: 'Lưu vào My Library', savedLibrary: 'Đã lưu ✓', copyLink: 'Sao chép liên kết',
        lastChecked: 'Kiểm tra lần cuối', fromDb: 'Dữ liệu từ DB, có thể chưa đầy đủ',
        staleWarning: 'Bản ghi trong DB nội bộ đã quá {days} ngày chưa kiểm chứng lại với nguồn gốc — tình trạng hiệu lực có thể đã thay đổi.',
        searchIsoObp: 'Tìm trên ISO OBP', searchGoogle: 'Tìm trên Google',
        noPdfNote: 'API hiện chỉ cung cấp metadata của tiêu chuẩn; chưa có file PDF để xem trực tuyến hoặc tải xuống trong hệ thống này.',
        fieldsTab: 'Thông tin', generalInfo: 'Thông tin chung', scope: 'Phạm vi áp dụng', related: 'Tài liệu liên quan', history: 'Lịch sử soát xét', sourceInfo: 'Thông tin nguồn',
        previewTitle: 'Xem trước thông tin tài liệu', previewNote: 'Đây là bản tóm tắt metadata từ API. Hệ thống chưa có trình xem PDF trực tuyến; vui lòng mở tài liệu tại nguồn gốc.',
        libraryTitle: 'Thư viện cá nhân', librarySubtitle: 'Tài liệu đã lưu và đã xem gần đây trên trình duyệt này (lưu bằng localStorage, chưa đồng bộ theo tài khoản).',
        favorites: 'Tài liệu đã lưu', favEmptyTitle: 'Chưa có tài liệu đã lưu', favEmptyText: 'Dùng nút “Lưu vào My Library” ở trang chi tiết hoặc kết quả tìm kiếm.',
        recentlyViewed: 'Đã xem gần đây', clearRecent: 'Xóa lịch sử xem', recentEmptyTitle: 'Chưa xem tài liệu nào', recentEmptyText: 'Các tài liệu bạn mở sẽ xuất hiện tại đây.',
        institute: 'Viện Công nghệ Đường sắt & TOD', footerTagline: 'Smart.Rail – Kết nối tri thức, kiến tạo tương lai',
        resultsFound: 'Tìm thấy {n} kết quả', showingPage: 'Hiển thị {n} kết quả trên trang này', loading: 'Đang tải...', requestFailed: 'Yêu cầu thất bại',
        noResults: 'Không có kết quả phù hợp', noResultsHint: 'Thử từ khóa khác hoặc bỏ bớt bộ lọc.', filteredOut: 'Không có kết quả nào khớp bộ lọc hiện tại.',
        partialFail: 'Một số nguồn không phản hồi: {list}. Kết quả hiển thị từ các nguồn còn lại.', sourceFailed: '{source}: lỗi',
        pageOf: 'Trang {page}', pageOfTotal: 'Trang {page} / {total}', totalResults: '{n} kết quả',
        viewDetail: 'Xem chi tiết', save: 'Lưu', yearLabel: 'Năm', statusLabel: 'Tình trạng', sourceLabel: 'Nguồn', codeLabel: 'Số hiệu',
        issuingAgency: 'Cơ quan ban hành', issuedDate: 'Ngày ban hành', effectiveDate: 'Ngày hiệu lực', replaces: 'Thay thế cho', replacedBy: 'Được thay thế bởi',
        notProvided: '—', enterQuery: 'Nhập ít nhất 2 ký tự để tìm kiếm', enterCode: 'Nhập số hiệu tiêu chuẩn',
        copied: 'Đã sao chép', copyFailed: 'Trình duyệt không cho phép sao chép', savedToast: 'Đã lưu vào My Library', removedToast: 'Đã xóa khỏi My Library',
        openCategory: 'Mở danh mục', documents: 'tài liệu',
        countUnavailable: 'Chưa tra cứu được số lượng', remove: 'Xóa', open: 'Mở', clearRecentDone: 'Đã xóa lịch sử xem',
        networkError: 'Không kết nối được tới máy chủ. Kiểm tra kết nối mạng rồi thử lại.', yearPrefix: 'Năm ban hành',
        documentsTitle: 'Tài liệu thư viện', documentsSubtitle: 'Tải tài liệu lên thư viện số của Viện (dịch vụ elib). Chỉ tài khoản admin hoặc editor mới được tải lên.',
        elibLoginTitle: 'Đăng nhập thư viện', elibLoginNote: 'Đăng nhập bằng email hoặc tên đăng nhập. Chưa có tài khoản? Đăng ký bên dưới, tài khoản sẽ chờ quản trị viên duyệt.',
        elibIdentifier: 'Email hoặc tên đăng nhập',
        elibEmail: 'Email', elibPassword: 'Mật khẩu', elibLogout: 'Đăng xuất', elibSignedInAs: 'Đã đăng nhập: {email} (quyền: {role})',
        elibNoPermissionTitle: 'Bạn không có quyền upload', elibNoPermissionText: 'Chỉ tài khoản admin hoặc editor mới được tải tài liệu lên. Liên hệ quản trị thư viện nếu bạn cần quyền này.',
        elibUploadTitle: 'Tải tài liệu lên', elibFile: 'File tài liệu', elibFileHint: 'PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG/PNG/WEBP, TXT, DWG — tối đa 200 MB. Định dạng được kiểm tra theo nội dung file.',
        elibTitle: 'Tiêu đề', elibDescription: 'Mô tả', elibCategory: 'Danh mục', elibNoCategory: '— Chưa chọn danh mục —',
        elibDocType: 'Loại tài liệu', elibDocTypePlaceholder: 'Ví dụ: Tiêu chuẩn, Báo cáo, Bản vẽ...', elibLanguage: 'Ngôn ngữ',
        elibTags: 'Từ khóa (tag)', elibTagsPlaceholder: 'Cách nhau bằng dấu phẩy', elibVisibility: 'Mức hiển thị',
        visInternal: 'Nội bộ', visPublic: 'Công khai', visMembers: 'Thành viên', visPrivate: 'Riêng tư', elibStatus: 'Trạng thái',
        stDraft: 'Bản nháp', stPublished: 'Đã xuất bản', stHidden: 'Ẩn', elibUpload: 'Tải lên', elibUploading: 'Đang tải lên...',
        elibSkip: 'Bỏ qua', elibForce: 'Vẫn tạo mới', elibDuplicateFallback: 'File này đã tồn tại trong thư viện. Bạn có thể bỏ qua hoặc vẫn tạo mới.',
        elibUploadOk: 'Đã tải lên thành công: {title}', elibDownload: 'Tải xuống', elibNeedFileTitle: 'Vui lòng chọn file và nhập tiêu đề tài liệu.',
        elibSessionTitle: 'Vừa tải lên trong phiên này', elibSessionNote: 'Danh sách này chỉ gồm các file bạn vừa tải lên trong phiên làm việc hiện tại (không lưu lại khi tải lại trang).',
        elibSessionEmptyTitle: 'Chưa tải lên tài liệu nào trong phiên này', elibSessionEmptyText: 'Tài liệu tải lên thành công sẽ xuất hiện tại đây kèm liên kết tải xuống.',
        elibPhase4Note: 'Tìm và tải xuống tài liệu đã tải lên tại mục Tìm kiếm → File tài liệu. Quản lý chi tiết (sửa, ẩn/xóa, phiên bản mới) sẽ có ở Giai đoạn 4.',
        elibDown: 'Không kết nối được tới dịch vụ tài liệu (elib). Các chức năng tra cứu tiêu chuẩn vẫn dùng bình thường.',
        elibDisabled: 'Tính năng tài liệu (elib) hiện đang tắt trên máy chủ này.',
        elibLoginFailed: 'Đăng nhập không thành công. Kiểm tra lại email và mật khẩu.', elibLoggedOut: 'Đã đăng xuất',
        elibCategoriesFailed: 'Không tải được danh mục từ elib; bạn vẫn có thể tải lên mà không chọn danh mục.',
        headerUpload: 'Tải lên', headerSignedInAs: '{email} · {role}',
        tabStandards: 'Tiêu chuẩn', tabFiles: 'File tài liệu',
        fileSearchLabel: 'Tìm file tài liệu', fileSearchPlaceholder: 'Tìm theo tiêu đề, mô tả, thẻ', fileSearchHint: 'Tìm theo tiêu đề, mô tả, thẻ',
        allCategories: 'Tất cả danh mục', fileEmptyTitle: 'Chưa có file nào', fileEmptyText: 'Nhập từ khóa ở trên để tìm file tài liệu trong thư viện.',
        fileNoResults: 'Không tìm thấy file phù hợp', fileNoResultsHint: 'Thử từ khóa khác hoặc chọn danh mục khác.',
        fileSearchError: 'Không tải được danh sách file. Dịch vụ tài liệu (elib) có thể đang bảo trì hoặc chưa sẵn sàng.',
        loadMore: 'Xem thêm', loginToDownload: 'Đăng nhập để tải', fileResultsFound: 'Tìm thấy {n} file',
        downloadContactHint: 'Liên hệ để được cấp quyền tải xuống.',
        downloadForbidden: 'Bạn không có quyền tải xuống tài liệu này. Chỉ chủ tài liệu hoặc quản trị viên mới tải xuống được.',
        downloadNotFound: 'Không tìm thấy file hoặc bạn không có quyền truy cập.',
        downloadRateLimited: 'Bạn đang thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.',
        downloadFailed: 'Không tải được file. Vui lòng thử lại sau.',
        viewPreview: 'Xem trước', viewFull: 'Xem toàn bộ', previewPreparing: 'Đang chuẩn bị bản xem trước',
        previewOfPages: 'Xem trước {x}/{y} trang', viewerPage: 'Trang {n}/{total}',
        previewEndTitle: 'Đã hết phần xem trước', previewEndLogin: 'Đăng nhập để xem thêm hoặc tải tài liệu.',
        previewEndContact: 'Liên hệ để được cấp quyền xem toàn bộ.',
        previewNotReady: 'Bản xem trước chưa sẵn sàng. Vui lòng thử lại sau ít phút.',
        previewPreparingLong: 'Đang chuẩn bị bản xem trước, vui lòng thử lại sau.',
        previewFailed: 'Không tạo được bản xem trước cho tài liệu này.',
        previewUnsupported: 'Định dạng này chưa hỗ trợ xem trước.',
        previewNotAvailable: 'Tài liệu này không có bản xem trước.',
        docNoAccess: 'Bạn không có quyền xem tài liệu này.',
        visibilityLabel: 'Mức hiển thị', visibilityPublic: 'Công khai', visibilityMembers: 'Thành viên', visibilityInternal: 'Nội bộ', visibilityPrivate: 'Riêng tư',
        visibilityUpdated: 'Đã đổi mức hiển thị.', visibilityLoginRequired: 'Vui lòng đăng nhập để đổi mức hiển thị.',
        visibilityForbidden: 'Bạn không có quyền đổi mức hiển thị của tài liệu này.', visibilityInvalid: 'Mức hiển thị không hợp lệ.',
        visibilityNotFound: 'Không tìm thấy tài liệu.', visibilityFailed: 'Không đổi được mức hiển thị. Vui lòng thử lại sau.',
        standardFileTitle: 'File tiêu chuẩn', standardFileNone: 'Chưa có file PDF cho tiêu chuẩn này.',
        standardFileView: 'Xem PDF', standardFileUpload: 'Tải file tiêu chuẩn',
        standardFileUploadHint: 'Chỉ nhận file PDF (tối đa 200 MB). File chỉ hiển thị với người trong tổ chức.',
        standardFileChoose: 'File PDF', standardVersionLabel: 'Nhãn phiên bản (tùy chọn)',
        standardVersionLabelPlaceholder: 'Ví dụ: Sửa đổi 1:2023',
        standardVersion: 'Phiên bản {n}', standardCurrentVersion: 'Bản hiện hành',
        standardSetCurrent: 'Đặt làm bản hiện hành', standardSetCurrentConfirm: 'Đặt phiên bản này làm bản hiện hành?',
        standardSetCurrentOk: 'Đã đặt lại phiên bản hiện hành.', standardSetCurrentFailed: 'Không đặt lại được phiên bản hiện hành. Vui lòng thử lại sau.',
        standardVersionHistory: 'Lịch sử phiên bản', standardUploadedAt: 'Tải lên {date}',
        codeCheckNotFound: 'Chưa thấy mã chuẩn trong vài trang đầu',
        standardUploadOk: 'Đã tải file tiêu chuẩn lên thành công.',
        standardFileMustPdf: 'File tiêu chuẩn chỉ chấp nhận định dạng PDF.',
        standardCodeInvalid: 'Mã tiêu chuẩn không hợp lệ. Vui lòng kiểm tra lại số hiệu tiêu chuẩn.',
        standardFileTooLarge: 'File vượt quá dung lượng tối đa cho phép.',
        standardUploadLoginRequired: 'Vui lòng đăng nhập để tải file tiêu chuẩn.',
        standardUploadForbidden: 'Chỉ quản trị viên hoặc người trong tổ chức mới tải được file tiêu chuẩn.',
        standardUploadFailed: 'Tải file tiêu chuẩn không thành công. Vui lòng thử lại sau.',
        standardNeedFile: 'Vui lòng chọn file PDF để tải lên.', pagesUnit: 'trang',
        summaryNote: 'Chưa tải được chi tiết từ nguồn — đang hiển thị thông tin tóm tắt',
        manualTitle: 'Nhập / sửa metadata (admin)', manualHint: 'Metadata nhập tay được lưu vào cơ sở dữ liệu tiêu chuẩn của thư viện (elib). Chỉ quản trị viên mới thấy mục này.',
        manualTitleVi: 'Tên tiếng Việt', manualTitleEn: 'Tên tiếng Anh', manualStatus: 'Tình trạng',
        manualIssuedDate: 'Ngày ban hành', manualEffectiveDate: 'Ngày hiệu lực',
        manualReplaces: 'Thay thế cho', manualReplacedBy: 'Được thay thế bởi',
        manualIcs: 'Mã ICS', manualIcsHint: 'Cách nhau bằng dấu phẩy, ví dụ: 91.010, 93.020',
        manualSave: 'Lưu metadata', manualSaved: 'Đã lưu metadata.',
        manualLoginRequired: 'Vui lòng đăng nhập lại để lưu metadata.',
        manualForbidden: 'Chỉ quản trị viên mới sửa được metadata.',
        manualNotFound: 'Không tìm thấy tiêu chuẩn trong cơ sở dữ liệu thư viện.',
        manualInvalid: 'Dữ liệu metadata không hợp lệ. Vui lòng kiểm tra lại các trường.',
        manualSaveFailed: 'Không lưu được metadata. Vui lòng thử lại sau.',
        navAdminUsers: 'Quản trị người dùng',
        elibShowRegister: 'Chưa có tài khoản? Đăng ký', elibShowLogin: 'Đã có tài khoản? Đăng nhập',
        elibRegisterTitle: 'Đăng ký tài khoản', elibRegisterNote: 'Tài khoản mới cần được quản trị viên duyệt trước khi đăng nhập. Bạn sẽ được thông báo khi tài khoản được duyệt.',
        elibRegister: 'Đăng ký', regUsername: 'Tên đăng nhập', regUsernameHint: '3–50 ký tự, không chứa khoảng trắng và ký tự @.',
        regEmail: 'Email', regPassword: 'Mật khẩu', regPasswordHint: '8–128 ký tự, không dùng mật khẩu phổ biến.',
        regPasswordConfirm: 'Nhập lại mật khẩu', regFullName: 'Họ tên thật', regDisplayName: 'Tên hiển thị', regOrganization: 'Đơn vị / công ty',
        regSuccess: 'Đã gửi đăng ký, vui lòng chờ admin duyệt.',
        regUsernameInvalid: 'Tên đăng nhập phải dài 3–50 ký tự, không chứa khoảng trắng và ký tự @.',
        regEmailInvalid: 'Email không hợp lệ. Vui lòng kiểm tra lại.',
        regFullNameRequired: 'Vui lòng nhập họ tên thật.',
        regPasswordShort: 'Mật khẩu phải có ít nhất 8 ký tự.', regPasswordLong: 'Mật khẩu không được dài quá 128 ký tự.',
        regPasswordMismatch: 'Hai mật khẩu không khớp. Vui lòng nhập lại.',
        regPasswordCommon: 'Mật khẩu này quá phổ biến, vui lòng chọn mật khẩu khác khó đoán hơn.',
        regPasswordIdentity: 'Mật khẩu không được trùng với tên đăng nhập hoặc email.',
        regUsernameTaken: 'Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.',
        regEmailTaken: 'Email đã được sử dụng. Vui lòng dùng email khác.',
        regPendingLimit: 'Số tài khoản đang chờ duyệt đã đạt giới hạn. Vui lòng thử lại sau.',
        regRateLimited: 'Bạn đang thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.',
        regInvalidInput: 'Dữ liệu đăng ký không hợp lệ. Vui lòng kiểm tra lại các trường.',
        regFailed: 'Đăng ký không thành công. Vui lòng thử lại sau.',
        loginPending: 'Tài khoản của bạn đang chờ quản trị viên duyệt. Vui lòng thử lại sau.',
        loginNotActive: 'Tài khoản không thể đăng nhập. Vui lòng liên hệ quản trị viên.',
        loginRateLimited: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng chờ một lát rồi thử lại.',
        changePasswordTitle: 'Đổi mật khẩu', changePasswordNote: 'Bạn đang dùng mật khẩu tạm do quản trị viên cấp. Vui lòng đặt mật khẩu mới trước khi tiếp tục sử dụng.',
        changeCurrentPassword: 'Mật khẩu hiện tại', changeNewPassword: 'Mật khẩu mới', changePasswordSubmit: 'Đổi mật khẩu',
        changeWrongCurrent: 'Mật khẩu hiện tại không đúng.', changeFailed: 'Không đổi được mật khẩu. Vui lòng thử lại sau.',
        changeSuccess: 'Đã đổi mật khẩu thành công.',
        adminUsersTitle: 'Quản trị người dùng', adminUsersSubtitle: 'Duyệt tài khoản đăng ký mới và quản lý người dùng thư viện (elib). Chỉ quản trị viên mới thấy mục này.',
        adminPendingTitle: 'Tài khoản chờ duyệt', adminPendingEmptyTitle: 'Không có tài khoản nào đang chờ duyệt', adminPendingEmptyText: 'Tài khoản đăng ký mới sẽ xuất hiện tại đây để duyệt.',
        adminManageTitle: 'Quản lý người dùng', adminStatusFilter: 'Trạng thái',
        adminManageEmptyTitle: 'Không có người dùng nào ở trạng thái này', adminManageEmptyText: 'Thử chọn trạng thái khác.',
        userStatusPending: 'Chờ duyệt', userStatusActive: 'Đang hoạt động', userStatusRejected: 'Đã từ chối', userStatusDisabled: 'Đã vô hiệu hóa',
        adminApprove: 'Duyệt', adminReject: 'Từ chối', adminBulkReject: 'Từ chối các tài khoản đã chọn',
        adminRejectReasonLabel: 'Lý do từ chối (nội bộ)', adminRejectReasonRequired: 'Vui lòng nhập lý do từ chối (nội bộ).',
        adminUserTypeLabel: 'Loại người dùng', userTypeInternal: 'Nội bộ', userTypeExternal: 'Khách ngoài', userTypeUnassigned: 'Chưa gán',
        adminSelectUserType: '— Chọn loại người dùng —', adminInternalEmailHint: 'Email thuộc tên miền công ty',
        adminRegisteredAt: 'Đăng ký lúc', adminRoleLabel: 'Quyền', roleAdmin: 'Admin', roleEditor: 'Editor', roleViewer: 'Viewer',
        adminDisable: 'Vô hiệu hóa', adminEnable: 'Kích hoạt lại', adminResetPassword: 'Đặt lại mật khẩu', adminUnlock: 'Mở khóa',
        adminUpdated: 'Đã cập nhật người dùng.', adminApproved: 'Đã duyệt tài khoản.', adminRejected: 'Đã từ chối tài khoản.',
        adminBulkRejected: 'Đã từ chối {n} tài khoản.', adminUnlocked: 'Đã mở khóa đăng nhập.',
        tempPasswordTitle: 'Mật khẩu tạm', tempPasswordNote: 'Mật khẩu tạm này chỉ hiển thị một lần duy nhất. Hãy sao chép và gửi cho người dùng qua kênh an toàn; họ sẽ phải đổi mật khẩu khi đăng nhập.',
        adminErrUserType: 'Phải chọn loại người dùng (nội bộ hoặc khách ngoài) khi duyệt.',
        adminErrNotPending: 'Chỉ duyệt/từ chối được tài khoản đang chờ duyệt.',
        adminErrRejectReason: 'Phải ghi lý do từ chối (nội bộ).',
        adminErrStatusTransition: 'Không chuyển trạng thái như vậy được. Duyệt dùng nút Duyệt, từ chối dùng nút Từ chối.',
        adminErrSelf: 'Không thể tự vô hiệu hóa hoặc thay đổi role của chính mình.',
        adminErrLastAdmin: 'Không thể vô hiệu hóa hoặc hạ role của quản trị viên cuối cùng.',
        adminErrEditorInternal: 'Chỉ gán role editor cho người dùng nội bộ.',
        adminErrNotFound: 'Không tìm thấy người dùng.', adminErrLoginRequired: 'Vui lòng đăng nhập lại.',
        adminErrForbidden: 'Chỉ quản trị viên mới thực hiện được thao tác này.', adminErrFailed: 'Thao tác không thành công. Vui lòng thử lại sau.',
        adminLoadFailed: 'Không tải được danh sách người dùng. Dịch vụ tài liệu (elib) có thể đang bảo trì.',
        adminSelectUserFirst: 'Vui lòng chọn ít nhất một tài khoản.',
        previewNotFound: 'Không tìm thấy tài liệu hoặc bạn không có quyền xem.',
        previewRateLimited: 'Bạn đang xem quá nhanh. Vui lòng chờ một lát rồi thử lại.',
        previewLoadError: 'Không tải được bản xem trước. Vui lòng thử lại sau.',
        viewerLoading: 'Đang tải tài liệu...', viewerClose: 'Đóng', viewerPrev: 'Trang trước', viewerNext: 'Trang sau',
        viewerDownload: 'Tải xuống', viewerPrint: 'In / mở bản gốc',
        tocTitle: 'Mục lục', tocToggle: 'Mục lục', tocClose: 'Đóng mục lục',
        tocFirstPage: 'Trang đầu', tocProcessing: 'Đang tạo mục lục…',
        tocSearchPlaceholder: 'Tìm trong mục lục...', tocNoMatches: 'Không có mục phù hợp.',
        tocSummaryLevel1: 'Mục lục tóm tắt cấp chương/phần',
        tocManualVerified: 'Mục lục đã kiểm duyệt',
        tocLockedNotice: 'Mục này cần quyền xem toàn văn tài liệu.',
        tocExpand: 'Mở rộng mục con', tocCollapse: 'Thu gọn mục con',
        tocLockedLabel: 'Cần quyền xem toàn văn',
        navAdminTocs: 'Quản trị mục lục',
        adminTocsTitle: 'Quản trị mục lục PDF',
        adminTocsSubtitle: 'Rà soát mục lục trích xuất tự động và chỉnh sửa mục lục thủ công cho tài liệu PDF. Chỉ quản trị viên mới thấy mục này.',
        adminTocBack: 'Quay lại danh sách',
        adminTocFilterAutoStatus: 'Trạng thái tự động',
        adminTocFilterJobStatus: 'Trạng thái job',
        adminTocFilterFlag: 'Cờ (flag)',
        adminTocFilterFlagPlaceholder: 'VD: contents_level1_only',
        adminTocFilterManual: 'Bản thủ công',
        adminTocFilterStandards: 'Phạm vi tài liệu',
        adminTocFilterOutdated: 'Thuật toán cũ hơn hiện tại',
        adminTocFilterApply: 'Lọc danh sách',
        adminTocFilterReset: 'Đặt lại',
        adminTocAll: 'Tất cả',
        adminTocManualYes: 'Có ghi đè thủ công',
        adminTocManualNo: 'Chưa có bản thủ công',
        adminTocStandardsOnly: 'Chỉ tiêu chuẩn',
        adminTocNonStandards: 'Tài liệu khác',
        adminTocStatusOk: 'Đạt (ok)',
        adminTocStatusPartial: 'Chưa đủ (partial)',
        adminTocStatusNeedsOcr: 'Cần OCR (needs_ocr)',
        adminTocStatusFailed: 'Thất bại (failed)',
        adminTocStatusUnsupported: 'Không hỗ trợ (unsupported)',
        adminTocJobPending: 'Đang chờ (pending)',
        adminTocJobProcessing: 'Đang xử lý (processing)',
        adminTocJobDone: 'Hoàn tất (done)',
        adminTocJobFailed: 'Lỗi (failed)',
        adminTocJobUnsupported: 'Không hỗ trợ (unsupported)',
        adminTocHasManual: 'Đang dùng bản thủ công',
        adminTocOutdatedAlgo: 'Thuật toán cũ',
        adminTocCurrentAlgo: 'Thuật toán hiện tại: {ver}',
        adminTocOpenDetail: 'Mở sửa TOC',
        adminTocEmptyTitle: 'Không có file PDF nào khớp bộ lọc',
        adminTocEmptyText: 'Thử bỏ bớt điều kiện lọc hoặc kiểm tra lại sau.',
        adminTocListSummary: 'Hiển thị {from}–{to} / {total} file · Thuật toán hiện tại: {ver}',
        adminTocAutoHeading: 'Cây mục lục tự động',
        adminTocAutoEmpty: 'Chưa có mục lục tự động (hoặc không trích được mục nào).',
        adminTocAutoReason: 'Lý do tự động: {reason}',
        adminTocAutoFlags: 'Cờ: {flags}',
        adminTocNeedsOcrPages: 'Trang cần OCR: {pages}',
        adminTocLastError: 'Lỗi job gần nhất: {err}',
        adminTocManualHeading: 'Trình sửa mục lục thủ công',
        adminTocManualHiddenActive: 'Đang bật bản thủ công rỗng (chủ động ẩn mục lục với người đọc)',
        adminTocManualActive: 'Đang dùng bản thủ công ({count} mục)',
        adminTocManualNone: 'Chưa có bản thủ công (đang hiển thị theo bản tự động nếu đạt).',
        adminTocNoteLabel: 'Ghi chú kiểm duyệt (tùy chọn)',
        adminTocNotePlaceholder: 'Ghi chú nội bộ về chỉnh sửa mục lục...',
        adminTocAddNode: '+ Thêm mục',
        adminTocClearNodes: 'Xóa hết mục',
        adminTocColTitle: 'Tiêu đề mục',
        adminTocColLevel: 'Cấp',
        adminTocColPage: 'Trang PDF',
        adminTocJumpPage: 'Xem trang',
        adminTocMoveUp: 'Lên',
        adminTocMoveDown: 'Xuống',
        adminTocInsertBelow: '+ Dưới',
        adminTocRemoveNode: 'Xóa',
        adminTocEditorEmpty: 'Chưa có mục nào trong bản thủ công. Bạn có thể thêm mục, chép từ bản tự động, hoặc lưu danh sách rỗng để chủ động ẩn mục lục.',
        adminTocSaveManual: 'Lưu bản thủ công',
        adminTocPromoteAuto: 'Chép từ bản tự động',
        adminTocDeleteManual: 'Gỡ bản thủ công',
        adminTocReextract: 'Chạy lại trích xuất',
        adminTocReextractNote: 'Lưu ý: người đọc vẫn thấy bản thủ công hiện hành cho tới khi quản trị viên duyệt xong hoặc gỡ bản thủ công.',
        adminTocSaveEmptyConfirm: 'Danh sách mục đang rỗng. Lưu bản thủ công rỗng sẽ chủ động ẨN mục lục đối với người đọc. Bạn có chắc muốn lưu?',
        adminTocDeleteManualConfirm: 'Gỡ bản mục lục thủ công của phiên bản file này và quay lại dùng kết quả trích xuất tự động?',
        adminTocSaved: 'Đã lưu bản mục lục thủ công.',
        adminTocPromoted: 'Đã chép cây tự động sang bản thủ công.',
        adminTocDeleted: 'Đã gỡ bản mục lục thủ công.',
        adminTocReextractQueued: 'Đã đưa file vào hàng đợi trích xuất lại mục lục.',
        adminTocPreviewHeading: 'Khung xem thử PDF',
        adminTocPreviewNonCurrentWarn: 'Khung xem thử hiện chỉ tải được phiên bản hiện hành của tài liệu; bạn đang sửa một phiên bản khác.',
        adminTocPreviewLoading: 'Đang tải PDF xem thử...',
        adminTocPreviewError: 'Không tải được PDF xem thử.',
        adminTocPreviewPageOf: '/ {total}',
        adminTocErrTitleEmpty: 'Mục #{index}: tiêu đề không được để trống.',
        adminTocErrTitleTooLong: 'Mục #{index}: tiêu đề vượt quá {max} ký tự.',
        adminTocErrLevelRange: 'Mục #{index}: cấp phải là số nguyên từ 1 đến 6.',
        adminTocErrPageInvalid: 'Mục #{index}: số trang phải là số nguyên >= 1.',
        adminTocErrPageRange: 'Mục #{index}: số trang ({page}) vượt ngoài phạm vi 1..{totalPages}.',
        adminTocErrTooManyNodes: 'Số lượng mục vượt quá giới hạn tối đa ({max} mục).',
        adminTocErrNoteTooLong: 'Ghi chú không được dài quá {max} ký tự.',
        adminTocErrProcessing: 'File này đang được trích xuất mục lục, vui lòng chờ hoàn tất rồi thử lại.',
        adminTocErrNoAuto: 'Chưa có cây mục lục tự động để chép sang bản thủ công.',
        adminTocErrUnsupported: 'Chỉ hỗ trợ trích xuất lại mục lục cho file PDF.',
        adminTocErrInvalid: 'Dữ liệu mục lục không hợp lệ. Vui lòng kiểm tra lại.',
        adminTocErrNotFound: 'Không tìm thấy file tài liệu.',
        adminTocErrFailed: 'Thao tác quản trị mục lục không thành công. Vui lòng thử lại sau.',
        adminTocLoadFailed: 'Không tải được danh sách mục lục. Dịch vụ tài liệu (elib) có thể đang bảo trì.',
        uploadedOn: 'Ngày tải lên', recentEmpty: 'Chưa có tài liệu nào được tải lên.',
        recentError: 'Không tải được tài liệu mới cập nhật. Dịch vụ tài liệu (elib) có thể đang bảo trì.',
        heroEyebrow: 'Viện Công nghệ Đường sắt & TOD · Tra cứu trực tuyến',
        explore: 'Khám phá',
        elibDropHint: 'Kéo thả file vào đây hoặc bấm để chọn từ máy tính',
        elibDropChange: 'Bấm hoặc kéo file khác để thay thế',
        browseStandards: 'Tra cứu tiêu chuẩn',
        activeFilters: '{n} bộ lọc'
      },
      en: {
        navHome: 'Home', navSearch: 'Search', navCategories: 'Categories', navDocuments: 'Documents', navLibrary: 'My Library',
        login: 'Sign in', loginNote: 'Sign in under Documents to upload and manage library documents.',
        heroTitle: 'Railway & TOD Knowledge Library', heroSubtitle: 'Discover, search and use specialist documents.',
        heroSearchLabel: 'Search documents', heroPlaceholder: 'Search documents, standards, projects...', search: 'Search',
        heroHint: 'Search by title, standard code or keyword. Data is queried live from VSQI and tracuu.tcvn.vn.',
        disciplines: 'Browse by discipline', discRail: 'Railway', discWorks: 'Structures', discElectric: 'Electrical – Electronics', discSignal: 'Signalling', discDigital: 'Digital Technology', discTod: 'TOD & Mobility',
        recentDocs: 'Recently updated', seeAll: 'See all', recentNote: 'The newest files uploaded to the digital library (elib), newest first.',
        featuredCollections: 'Featured collections', collectionsNote: 'Collections are topic search shortcuts; results are always queried live from the API.',
        colRail: 'Railway standards', colRailDesc: 'Standards and regulations for railways', colSafety: 'Railway safety', colSafetyDesc: 'Documents on safe operation',
        colBim: 'BIM & digital', colBimDesc: 'Information modelling and digital transformation', colTod: 'TOD & planning', colTodDesc: 'Transit-oriented development',
        colQuality: 'Quality management', colQualityDesc: 'ISO quality management systems', colWater: 'Hydraulic structures', colWaterDesc: 'Standards for hydraulic works',
        searchTitle: 'Document search', searchSubtitle: 'Search documents, standards and specialist publications from VSQI and tracuu.tcvn.vn.',
        keyword: 'Keyword', searchPlaceholder: 'Enter a keyword (e.g. railway standard, BIM, TOD...)', try: 'Try:', advanced: 'Advanced search',
        advSource: 'Data source', allSources: 'All sources', advYear: 'Publication year', advOrg: 'Organisation / document type', advOrgPlaceholder: 'E.g. ISO, TCVN, QCVN...',
        advancedNote: 'Advanced search adds terms to the query; source and year filter the returned results in the browser.',
        filters: 'Filter results', clearFilters: 'Clear all', filterSource: 'Source', filterYear: 'Year', filterStatus: 'Status',
        allStatuses: 'All', statusActive: 'Active', statusWithdrawn: 'Withdrawn',
        filterNote: 'Filters apply to the current results page in the browser. The API only accepts a keyword and a page number.',
        awaiting: 'No query yet', sort: 'Sort:', sortRelevance: 'Most relevant', sortNewest: 'Newest', sortTitle: 'Title A–Z',
        listView: 'List', gridView: 'Grid', emptyTitle: 'Ready to search', emptyText: 'Enter a keyword above to search VSQI and tracuu.tcvn.vn.',
        prevPage: 'Previous', nextPage: 'Next', pagingNote: 'Pagination applies per data source.',
        copyUrl: 'Copy URL', httpStatus: 'HTTP', responseTime: 'Time', rawJson: 'Raw JSON', copyJson: 'Copy JSON',
        categoriesTitle: 'Document categories', categoriesSubtitle: 'Explore the knowledge base by field. Counts are queried live from the API using each category keyword.',
        categoriesNote: 'There is no dedicated taxonomy yet; each category is a topic search on the existing API.',
        detailCodeLabel: 'Standard code', detailSourceLabel: 'Source', autoSource: 'Automatic (VSQI → VN → QT)', getDetail: 'View detail',
        detailEmptyTitle: 'No document selected', detailEmptyText: 'Enter a code above or pick a search result.',
        coverKind: 'STANDARD', viewAtSource: 'View at source', preview: 'Preview metadata', saveLibrary: 'Save to My Library', savedLibrary: 'Saved ✓', copyLink: 'Copy link',
        lastChecked: 'Last verified', fromDb: 'Data from internal DB, may be incomplete',
        staleWarning: 'The internal DB record has not been re-verified against the source for over {days} days — its status may have changed.',
        searchIsoObp: 'Search on ISO OBP', searchGoogle: 'Search on Google',
        noPdfNote: 'The API provides standard metadata only; there is no PDF to view or download in this system yet.',
        fieldsTab: 'Information', generalInfo: 'General information', scope: 'Scope', related: 'Related documents', history: 'Revision history', sourceInfo: 'Source information',
        previewTitle: 'Document metadata preview', previewNote: 'This is a metadata summary from the API. There is no online PDF viewer yet; please open the document at its source.',
        libraryTitle: 'My Library', librarySubtitle: 'Saved and recently viewed documents in this browser (localStorage, not synced per account).',
        favorites: 'Saved documents', favEmptyTitle: 'No saved documents yet', favEmptyText: 'Use “Save to My Library” on the detail page or in search results.',
        recentlyViewed: 'Recently viewed', clearRecent: 'Clear viewing history', recentEmptyTitle: 'Nothing viewed yet', recentEmptyText: 'Documents you open will appear here.',
        institute: 'Institute of Railway Technology & TOD', footerTagline: 'Smart.Rail – Connecting knowledge, shaping the future',
        resultsFound: 'Found {n} results', showingPage: 'Showing {n} results on this page', loading: 'Loading...', requestFailed: 'Request failed',
        noResults: 'No matching results', noResultsHint: 'Try another keyword or remove filters.', filteredOut: 'No results match the current filters.',
        partialFail: 'Some sources did not respond: {list}. Showing results from the remaining sources.', sourceFailed: '{source}: failed',
        pageOf: 'Page {page}', pageOfTotal: 'Page {page} of {total}', totalResults: '{n} results',
        viewDetail: 'View detail', save: 'Save', yearLabel: 'Year', statusLabel: 'Status', sourceLabel: 'Source', codeLabel: 'Code',
        issuingAgency: 'Issuing agency', issuedDate: 'Issued date', effectiveDate: 'Effective date', replaces: 'Replaces', replacedBy: 'Replaced by',
        notProvided: '—', enterQuery: 'Enter at least 2 characters to search', enterCode: 'Enter a standard code',
        copied: 'Copied', copyFailed: 'Clipboard is unavailable in this browser', savedToast: 'Saved to My Library', removedToast: 'Removed from My Library',
        openCategory: 'Open category', documents: 'documents',
        countUnavailable: 'Count unavailable', remove: 'Remove', open: 'Open', clearRecentDone: 'Viewing history cleared',
        networkError: 'Unable to reach the server. Check your network connection and retry.', yearPrefix: 'Year',
        documentsTitle: 'Library documents', documentsSubtitle: 'Upload documents to the Institute digital library (elib service). Only admin or editor accounts may upload.',
        elibLoginTitle: 'Library sign-in', elibLoginNote: 'Sign in with your email or username. No account yet? Register below; an administrator must approve it first.',
        elibIdentifier: 'Email or username',
        elibEmail: 'Email', elibPassword: 'Password', elibLogout: 'Sign out', elibSignedInAs: 'Signed in: {email} (role: {role})',
        elibNoPermissionTitle: 'You do not have upload permission', elibNoPermissionText: 'Only admin or editor accounts may upload documents. Contact the library administrator if you need this permission.',
        elibUploadTitle: 'Upload a document', elibFile: 'Document file', elibFileHint: 'PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG/PNG/WEBP, TXT, DWG — up to 200 MB. The real format is checked from file content.',
        elibTitle: 'Title', elibDescription: 'Description', elibCategory: 'Category', elibNoCategory: '— No category selected —',
        elibDocType: 'Document type', elibDocTypePlaceholder: 'E.g. Standard, Report, Drawing...', elibLanguage: 'Language',
        elibTags: 'Tags', elibTagsPlaceholder: 'Comma-separated', elibVisibility: 'Visibility',
        visInternal: 'Internal', visPublic: 'Public', visMembers: 'Members', visPrivate: 'Private', elibStatus: 'Status',
        stDraft: 'Draft', stPublished: 'Published', stHidden: 'Hidden', elibUpload: 'Upload', elibUploading: 'Uploading...',
        elibSkip: 'Skip', elibForce: 'Create anyway', elibDuplicateFallback: 'This file already exists in the library. You can skip it or create a new copy.',
        elibUploadOk: 'Uploaded successfully: {title}', elibDownload: 'Download', elibNeedFileTitle: 'Please choose a file and enter a document title.',
        elibSessionTitle: 'Uploaded in this session', elibSessionNote: 'This list only contains files you uploaded in the current session (it is not kept after a page reload).',
        elibSessionEmptyTitle: 'Nothing uploaded in this session yet', elibSessionEmptyText: 'Successfully uploaded documents will appear here with a download link.',
        elibPhase4Note: 'Find and download uploaded documents under Search → Document files. Detailed management (edit, hide/delete, new versions) arrives in Phase 4.',
        elibDown: 'Unable to reach the document service (elib). Standards search keeps working as usual.',
        elibDisabled: 'The document feature (elib) is currently disabled on this server.',
        elibLoginFailed: 'Sign-in failed. Check your email and password.', elibLoggedOut: 'Signed out',
        elibCategoriesFailed: 'Could not load categories from elib; you can still upload without a category.',
        headerUpload: 'Upload', headerSignedInAs: '{email} · {role}',
        tabStandards: 'Standards', tabFiles: 'Document files',
        fileSearchLabel: 'Search document files', fileSearchPlaceholder: 'Search by title, description, tags', fileSearchHint: 'Search by title, description, tags',
        allCategories: 'All categories', fileEmptyTitle: 'No files yet', fileEmptyText: 'Enter a keyword above to search document files in the library.',
        fileNoResults: 'No matching files', fileNoResultsHint: 'Try another keyword or a different category.',
        fileSearchError: 'Could not load the file list. The document service (elib) may be under maintenance or not ready yet.',
        loadMore: 'Load more', loginToDownload: 'Sign in to download', fileResultsFound: 'Found {n} files',
        downloadContactHint: 'Contact us to request download access.',
        downloadForbidden: 'You do not have permission to download this document. Only the document owner or an administrator can download it.',
        downloadNotFound: 'File not found, or you do not have access to it.',
        downloadRateLimited: 'You are doing this too quickly. Please wait a moment and try again.',
        downloadFailed: 'Could not download the file. Please try again later.',
        viewPreview: 'Preview', viewFull: 'View full', previewPreparing: 'Preparing preview',
        previewOfPages: 'Preview {x}/{y} pages', viewerPage: 'Page {n}/{total}',
        previewEndTitle: 'End of preview', previewEndLogin: 'Sign in to see more or download the document.',
        previewEndContact: 'Contact us to request full access.',
        previewNotReady: 'The preview is not ready yet. Please try again in a few minutes.',
        previewPreparingLong: 'The preview is being prepared. Please try again later.',
        previewFailed: 'Could not create a preview for this document.',
        previewUnsupported: 'This format does not support preview yet.',
        previewNotAvailable: 'This document has no preview.',
        docNoAccess: 'You do not have access to this document.',
        visibilityLabel: 'Visibility', visibilityPublic: 'Public', visibilityMembers: 'Members', visibilityInternal: 'Internal', visibilityPrivate: 'Private',
        visibilityUpdated: 'Visibility updated.', visibilityLoginRequired: 'Please sign in to change visibility.',
        visibilityForbidden: 'You do not have permission to change this document\'s visibility.', visibilityInvalid: 'Invalid visibility value.',
        visibilityNotFound: 'Document not found.', visibilityFailed: 'Could not change visibility. Please try again later.',
        standardFileTitle: 'Standard file', standardFileNone: 'No PDF file for this standard yet.',
        standardFileView: 'View PDF', standardFileUpload: 'Upload standard file',
        standardFileUploadHint: 'PDF only (max 200 MB). The file is visible to organization members only.',
        standardFileChoose: 'PDF file', standardVersionLabel: 'Version label (optional)',
        standardVersionLabelPlaceholder: 'e.g. Amendment 1:2023',
        standardVersion: 'Version {n}', standardCurrentVersion: 'Current version',
        standardSetCurrent: 'Set as current version', standardSetCurrentConfirm: 'Set this version as the current version?',
        standardSetCurrentOk: 'Current version updated.', standardSetCurrentFailed: 'Could not update the current version. Please try again later.',
        standardVersionHistory: 'Version history', standardUploadedAt: 'Uploaded {date}',
        codeCheckNotFound: 'Standard code not found in the first pages',
        standardUploadOk: 'Standard file uploaded successfully.',
        standardFileMustPdf: 'Standard files must be PDF.',
        standardCodeInvalid: 'Invalid standard code. Please check the standard number.',
        standardFileTooLarge: 'The file exceeds the maximum allowed size.',
        standardUploadLoginRequired: 'Please sign in to upload a standard file.',
        standardUploadForbidden: 'Only admins or organization members can upload standard files.',
        standardUploadFailed: 'Standard file upload failed. Please try again later.',
        standardNeedFile: 'Please choose a PDF file to upload.', pagesUnit: 'pages',
        summaryNote: 'Could not load details from the source — showing summary information',
        manualTitle: 'Edit metadata (admin)', manualHint: 'Manually entered metadata is stored in the library standards database (elib). Only administrators see this section.',
        manualTitleVi: 'Vietnamese title', manualTitleEn: 'English title', manualStatus: 'Status',
        manualIssuedDate: 'Issued date', manualEffectiveDate: 'Effective date',
        manualReplaces: 'Replaces', manualReplacedBy: 'Replaced by',
        manualIcs: 'ICS codes', manualIcsHint: 'Comma-separated, e.g. 91.010, 93.020',
        manualSave: 'Save metadata', manualSaved: 'Metadata saved.',
        manualLoginRequired: 'Please sign in again to save metadata.',
        manualForbidden: 'Only administrators can edit metadata.',
        manualNotFound: 'Standard not found in the library database.',
        manualInvalid: 'Invalid metadata. Please check the fields.',
        manualSaveFailed: 'Could not save metadata. Please try again later.',
        navAdminUsers: 'User administration',
        elibShowRegister: 'No account yet? Register', elibShowLogin: 'Already have an account? Sign in',
        elibRegisterTitle: 'Register an account', elibRegisterNote: 'New accounts must be approved by an administrator before you can sign in. You will be notified once approved.',
        elibRegister: 'Register', regUsername: 'Username', regUsernameHint: '3–50 characters, no spaces or @.',
        regEmail: 'Email', regPassword: 'Password', regPasswordHint: '8–128 characters; do not use a common password.',
        regPasswordConfirm: 'Confirm password', regFullName: 'Full name', regDisplayName: 'Display name', regOrganization: 'Organisation / company',
        regSuccess: 'Registration submitted. Please wait for an administrator to approve it.',
        regUsernameInvalid: 'Username must be 3–50 characters with no spaces or @.',
        regEmailInvalid: 'Invalid email address. Please check it.',
        regFullNameRequired: 'Please enter your full name.',
        regPasswordShort: 'Password must be at least 8 characters.', regPasswordLong: 'Password must be at most 128 characters.',
        regPasswordMismatch: 'The two passwords do not match. Please re-enter them.',
        regPasswordCommon: 'This password is too common; please choose a harder-to-guess one.',
        regPasswordIdentity: 'Password must not match your username or email.',
        regUsernameTaken: 'This username is already taken. Please choose another.',
        regEmailTaken: 'This email is already in use. Please use another email.',
        regPendingLimit: 'The pending-approval limit has been reached. Please try again later.',
        regRateLimited: 'You are doing this too quickly. Please wait a moment and try again.',
        regInvalidInput: 'Invalid registration data. Please check the fields.',
        regFailed: 'Registration failed. Please try again later.',
        loginPending: 'Your account is awaiting administrator approval. Please try again later.',
        loginNotActive: 'This account cannot sign in. Please contact an administrator.',
        loginRateLimited: 'Too many sign-in attempts. Please wait a moment and try again.',
        changePasswordTitle: 'Change password', changePasswordNote: 'You are using a temporary password issued by an administrator. Please set a new password before continuing.',
        changeCurrentPassword: 'Current password', changeNewPassword: 'New password', changePasswordSubmit: 'Change password',
        changeWrongCurrent: 'The current password is incorrect.', changeFailed: 'Could not change the password. Please try again later.',
        changeSuccess: 'Password changed successfully.',
        adminUsersTitle: 'User administration', adminUsersSubtitle: 'Approve new registrations and manage library users (elib). Only administrators see this section.',
        adminPendingTitle: 'Accounts awaiting approval', adminPendingEmptyTitle: 'No accounts are awaiting approval', adminPendingEmptyText: 'New registrations will appear here for approval.',
        adminManageTitle: 'Manage users', adminStatusFilter: 'Status',
        adminManageEmptyTitle: 'No users with this status', adminManageEmptyText: 'Try a different status.',
        userStatusPending: 'Pending', userStatusActive: 'Active', userStatusRejected: 'Rejected', userStatusDisabled: 'Disabled',
        adminApprove: 'Approve', adminReject: 'Reject', adminBulkReject: 'Reject selected accounts',
        adminRejectReasonLabel: 'Rejection reason (internal)', adminRejectReasonRequired: 'Please enter a rejection reason (internal).',
        adminUserTypeLabel: 'User type', userTypeInternal: 'Internal', userTypeExternal: 'External', userTypeUnassigned: 'Unassigned',
        adminSelectUserType: '— Select user type —', adminInternalEmailHint: 'Email belongs to a company domain',
        adminRegisteredAt: 'Registered', adminRoleLabel: 'Role', roleAdmin: 'Admin', roleEditor: 'Editor', roleViewer: 'Viewer',
        adminDisable: 'Disable', adminEnable: 'Re-enable', adminResetPassword: 'Reset password', adminUnlock: 'Unlock',
        adminUpdated: 'User updated.', adminApproved: 'Account approved.', adminRejected: 'Account rejected.',
        adminBulkRejected: 'Rejected {n} accounts.', adminUnlocked: 'Sign-in unlocked.',
        tempPasswordTitle: 'Temporary password', tempPasswordNote: 'This temporary password is shown only once. Copy it and send it to the user over a secure channel; they must change it when signing in.',
        adminErrUserType: 'You must choose a user type (internal or external) when approving.',
        adminErrNotPending: 'Only pending accounts can be approved or rejected.',
        adminErrRejectReason: 'A rejection reason (internal) is required.',
        adminErrStatusTransition: 'That status change is not allowed. Use Approve to approve and Reject to reject.',
        adminErrSelf: 'You cannot disable or change the role of your own account.',
        adminErrLastAdmin: 'You cannot disable or demote the last administrator.',
        adminErrEditorInternal: 'The editor role can only be assigned to internal users.',
        adminErrNotFound: 'User not found.', adminErrLoginRequired: 'Please sign in again.',
        adminErrForbidden: 'Only administrators can do this.', adminErrFailed: 'The action failed. Please try again later.',
        adminLoadFailed: 'Could not load the user list. The document service (elib) may be under maintenance.',
        adminSelectUserFirst: 'Please select at least one account.',
        previewNotFound: 'Document not found, or you do not have access to it.',
        previewRateLimited: 'You are viewing too quickly. Please wait a moment and try again.',
        previewLoadError: 'Could not load the preview. Please try again later.',
        viewerLoading: 'Loading document...', viewerClose: 'Close', viewerPrev: 'Previous page', viewerNext: 'Next page',
        viewerDownload: 'Download', viewerPrint: 'Print / open original',
        tocTitle: 'Table of contents', tocToggle: 'Contents', tocClose: 'Close table of contents',
        tocFirstPage: 'First page', tocProcessing: 'Generating table of contents…',
        tocSearchPlaceholder: 'Search table of contents...', tocNoMatches: 'No matching headings.',
        tocSummaryLevel1: 'Summary table of contents (chapter/part level)',
        tocManualVerified: 'Curated table of contents',
        tocLockedNotice: 'Full access is required to view this section.',
        tocExpand: 'Expand subsections', tocCollapse: 'Collapse subsections',
        tocLockedLabel: 'Full access required',
        navAdminTocs: 'TOC admin',
        adminTocsTitle: 'PDF TOC administration',
        adminTocsSubtitle: 'Review automatically extracted tables of contents and curate manual TOCs for PDFs. Only administrators see this section.',
        adminTocBack: 'Back to list',
        adminTocFilterAutoStatus: 'Auto status',
        adminTocFilterJobStatus: 'Job status',
        adminTocFilterFlag: 'Flag',
        adminTocFilterFlagPlaceholder: 'e.g. contents_level1_only',
        adminTocFilterManual: 'Manual override',
        adminTocFilterStandards: 'Document scope',
        adminTocFilterOutdated: 'Outdated algorithm',
        adminTocFilterApply: 'Apply filters',
        adminTocFilterReset: 'Reset',
        adminTocAll: 'All',
        adminTocManualYes: 'Has manual override',
        adminTocManualNo: 'No manual override',
        adminTocStandardsOnly: 'Standards only',
        adminTocNonStandards: 'Other documents',
        adminTocStatusOk: 'OK (ok)',
        adminTocStatusPartial: 'Partial (partial)',
        adminTocStatusNeedsOcr: 'Needs OCR (needs_ocr)',
        adminTocStatusFailed: 'Failed (failed)',
        adminTocStatusUnsupported: 'Unsupported (unsupported)',
        adminTocJobPending: 'Pending (pending)',
        adminTocJobProcessing: 'Processing (processing)',
        adminTocJobDone: 'Done (done)',
        adminTocJobFailed: 'Failed (failed)',
        adminTocJobUnsupported: 'Unsupported (unsupported)',
        adminTocHasManual: 'Manual TOC active',
        adminTocOutdatedAlgo: 'Outdated algorithm',
        adminTocCurrentAlgo: 'Current algorithm: {ver}',
        adminTocOpenDetail: 'Edit TOC',
        adminTocEmptyTitle: 'No PDF files match these filters',
        adminTocEmptyText: 'Try relaxing the filters or check again later.',
        adminTocListSummary: 'Showing {from}–{to} of {total} files · Current algorithm: {ver}',
        adminTocAutoHeading: 'Automatic TOC tree',
        adminTocAutoEmpty: 'No automatic TOC entries extracted.',
        adminTocAutoReason: 'Auto reason: {reason}',
        adminTocAutoFlags: 'Flags: {flags}',
        adminTocNeedsOcrPages: 'Pages needing OCR: {pages}',
        adminTocLastError: 'Last job error: {err}',
        adminTocManualHeading: 'Manual TOC editor',
        adminTocManualHiddenActive: 'Empty manual TOC active (TOC is hidden from readers)',
        adminTocManualActive: 'Manual TOC active ({count} entries)',
        adminTocManualNone: 'No manual override (readers see the automatic TOC when ok).',
        adminTocNoteLabel: 'Review note (optional)',
        adminTocNotePlaceholder: 'Internal note about manual TOC edits...',
        adminTocAddNode: '+ Add entry',
        adminTocClearNodes: 'Clear all',
        adminTocColTitle: 'Heading title',
        adminTocColLevel: 'Level',
        adminTocColPage: 'PDF page',
        adminTocJumpPage: 'View page',
        adminTocMoveUp: 'Up',
        adminTocMoveDown: 'Down',
        adminTocInsertBelow: '+ Below',
        adminTocRemoveNode: 'Delete',
        adminTocEditorEmpty: 'No entries in the manual TOC yet. Add entries, promote from automatic extraction, or save an empty list to hide the TOC from readers.',
        adminTocSaveManual: 'Save manual TOC',
        adminTocPromoteAuto: 'Promote from auto',
        adminTocDeleteManual: 'Delete manual TOC',
        adminTocReextract: 'Re-extract TOC',
        adminTocReextractNote: 'Note: readers will continue seeing the active manual TOC until an administrator reviews or removes the manual override.',
        adminTocSaveEmptyConfirm: 'The entry list is empty. Saving an empty manual TOC will intentionally HIDE the table of contents from readers. Continue?',
        adminTocDeleteManualConfirm: 'Remove the manual TOC override for this file version and revert to the automatic extraction?',
        adminTocSaved: 'Manual TOC saved.',
        adminTocPromoted: 'Automatic TOC copied to manual override.',
        adminTocDeleted: 'Manual TOC removed.',
        adminTocReextractQueued: 'File queued for TOC re-extraction.',
        adminTocPreviewHeading: 'PDF preview pane',
        adminTocPreviewNonCurrentWarn: 'The preview pane can only load the current version of this document; you are editing a different version.',
        adminTocPreviewLoading: 'Loading preview PDF...',
        adminTocPreviewError: 'Could not load preview PDF.',
        adminTocPreviewPageOf: '/ {total}',
        adminTocErrTitleEmpty: 'Entry #{index}: title must not be empty.',
        adminTocErrTitleTooLong: 'Entry #{index}: title exceeds {max} characters.',
        adminTocErrLevelRange: 'Entry #{index}: level must be an integer between 1 and 6.',
        adminTocErrPageInvalid: 'Entry #{index}: page number must be an integer >= 1.',
        adminTocErrPageRange: 'Entry #{index}: page ({page}) is outside 1..{totalPages}.',
        adminTocErrTooManyNodes: 'Entry count exceeds the maximum of {max} entries.',
        adminTocErrNoteTooLong: 'Note must not exceed {max} characters.',
        adminTocErrProcessing: 'TOC extraction is already processing for this file.',
        adminTocErrNoAuto: 'No automatic TOC tree is available to promote.',
        adminTocErrUnsupported: 'TOC re-extraction is only supported for PDF files.',
        adminTocErrInvalid: 'Invalid TOC data. Please check the entries.',
        adminTocErrNotFound: 'Document file not found.',
        adminTocErrFailed: 'TOC admin action failed. Please try again later.',
        adminTocLoadFailed: 'Could not load the TOC review list. The document service (elib) may be under maintenance.',
        uploadedOn: 'Uploaded', recentEmpty: 'No documents have been uploaded yet.',
        recentError: 'Could not load recent documents. The document service (elib) may be under maintenance.',
        heroEyebrow: 'Institute of Railway Technology & TOD · Live Search',
        explore: 'Explore',
        elibDropHint: 'Drag & drop a file here, or click to browse',
        elibDropChange: 'Click or drag another file to replace',
        browseStandards: 'Browse standards',
        activeFilters: '{n} active'
      }
    };
    const t = (key, vars = {}) => {
      let text = I18N[currentLang][key] || I18N.vi[key] || key;
      for (const [name, value] of Object.entries(vars)) text = text.replace(`{${name}}`, String(value));
      return text;
    };

    const CATEGORIES = [
      { id: 'CAT01', vi: 'Hạ tầng đường sắt', en: 'Railway Infrastructure', query: 'hạ tầng đường sắt', subs: [
        { vi: 'Thiết kế hạ tầng', en: 'Infrastructure Design', query: 'thiết kế hạ tầng đường sắt' },
        { vi: 'Xây dựng và thi công', en: 'Construction', query: 'thi công đường sắt' },
        { vi: 'Bảo trì và quản lý tài sản', en: 'Asset Management', query: 'bảo trì đường sắt' },
        { vi: 'An toàn đường sắt', en: 'Railway Safety', query: 'an toàn đường sắt' },
        { vi: 'Công trình đặc biệt', en: 'Special Structures', query: 'cầu đường sắt' }
      ] },
      { id: 'CAT02', vi: 'Hệ thống đường sắt', en: 'Railway Systems', query: 'hệ thống đường sắt', subs: [
        { vi: 'Tín hiệu và điều khiển', en: 'Signalling & Control', query: 'tín hiệu đường sắt' },
        { vi: 'Điện khí hóa', en: 'Electrification', query: 'điện khí hóa đường sắt' },
        { vi: 'Đầu máy toa xe', en: 'Rolling Stock', query: 'toa xe đường sắt' },
        { vi: 'Vận hành khai thác', en: 'Operations', query: 'khai thác đường sắt' }
      ] },
      { id: 'CAT03', vi: 'Công nghệ số', en: 'Digital Engineering', query: 'công nghệ số', subs: [
        { vi: 'BIM', en: 'BIM', query: 'BIM' },
        { vi: 'Mô hình thông tin', en: 'Information Modelling', query: 'mô hình thông tin' },
        { vi: 'Chuyển đổi số', en: 'Digital Transformation', query: 'chuyển đổi số' }
      ] },
      { id: 'CAT04', vi: 'Quy hoạch giao thông', en: 'Transport Planning', query: 'quy hoạch giao thông', subs: [
        { vi: 'Quy hoạch đường sắt', en: 'Railway Planning', query: 'quy hoạch đường sắt' },
        { vi: 'TOD', en: 'TOD', query: 'TOD' },
        { vi: 'Giao thông đô thị', en: 'Urban Transport', query: 'giao thông đô thị' }
      ] },
      { id: 'CAT05', vi: 'Tiêu chuẩn & Quy chuẩn', en: 'Standards & Regulations', query: 'tiêu chuẩn', subs: [
        { vi: 'Tiêu chuẩn quốc gia', en: 'National Standards', query: 'TCVN' },
        { vi: 'Quy chuẩn quốc gia', en: 'National Regulations', query: 'QCVN' },
        { vi: 'Tiêu chuẩn quốc tế', en: 'International Standards', query: 'ISO' }
      ] },
      { id: 'CAT06', vi: 'Nghiên cứu & Phát triển', en: 'Research & Development', query: 'nghiên cứu', subs: [
        { vi: 'Nghiên cứu khoa học', en: 'Scientific Research', query: 'nghiên cứu khoa học' },
        { vi: 'Báo cáo kỹ thuật', en: 'Technical Reports', query: 'báo cáo kỹ thuật' },
        { vi: 'Đổi mới sáng tạo', en: 'Innovation', query: 'sáng tạo' }
      ] }
    ];

    const searchForm = $('#search-form');
    const detailForm = $('#detail-form');
    const searchInput = $('#search-query');
    const searchPage = $('#search-page');
    const detailInput = $('#detail-code-input');
    const detailSourceSelect = $('#detail-source-select');
    // All API calls are same-origin relative paths (the UI is always served
    // by the same Fastify app that hosts /api/* and the /api/elib proxy).

    function showToast(message) {
      const toast = $('#toast');
      toast.textContent = message;
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    }

    function highlightJson(raw) {
      const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false)\b|\bnull\b)/g;
      let output = '';
      let lastIndex = 0;
      for (const match of raw.matchAll(tokenPattern)) {
        const token = match[0];
        output += escapeHtml(raw.slice(lastIndex, match.index));
        const className = token === 'null' ? 'json-null' : token === 'true' || token === 'false' ? 'json-boolean'
          : token.startsWith('"') ? /"\s*:$/.test(token) ? 'json-key' : 'json-string' : 'json-number';
        output += `<span class="${className}">${escapeHtml(token)}</span>`;
        lastIndex = match.index + token.length;
      }
      return output + escapeHtml(raw.slice(lastIndex));
    }

    function renderRaw(kind, raw) { $(`#${kind}-raw-json`).innerHTML = highlightJson(raw || ''); }

    async function fetchApi(path) {
      const started = performance.now();
      const timestamp = new Date().toLocaleString();
      const url = path;
      try {
        const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
        const raw = await response.text();
        let payload;
        let errorMessage = '';
        try {
          payload = JSON.parse(raw);
          if (!response.ok) errorMessage = payload?.error?.message || `HTTP ${response.status}`;
        } catch { errorMessage = `Non-JSON response (HTTP ${response.status})`; }
        return { raw, payload, duration: performance.now() - started, timestamp, status: response.status, statusText: response.statusText, ok: response.ok && payload !== undefined && !errorMessage, errorMessage, url };
      } catch (error) {
        return { raw: '', payload: undefined, duration: performance.now() - started, timestamp, status: null, statusText: '', ok: false, errorMessage: error instanceof TypeError ? t('networkError') : error.message, url };
      }
    }

    function updateInspector(kind, result) {
      const box = $(`#${kind}-inspector`);
      if (!box) return;
      box.hidden = false;
      $(`#${kind}-timestamp`).textContent = result.timestamp;
      $(`#${kind}-request-url`).textContent = result.url;
      const statusEl = $(`#${kind}-http-status`);
      statusEl.textContent = result.status === null ? 'Network error' : `${result.status} ${result.statusText}`;
      const ok = Boolean(result.status && result.status >= 200 && result.status < 300);
      statusEl.classList.toggle('is-ok', ok);
      statusEl.classList.toggle('is-err', !ok);
      $(`#${kind}-response-time`).textContent = `${result.duration.toFixed(1)} ms`;
    }

    // ---- localStorage: favorites + recently viewed ----
    const readList = key => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
    const writeList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list.slice(0, 60))); } catch { /* storage unavailable */ } };
    const favKey = item => `${item.source || ''}|${item.code}`;
    const getFavorites = () => readList('smartrail-favorites');
    const getRecent = () => readList('smartrail-recent');
    const isFavorite = item => getFavorites().some(f => favKey(f) === favKey(item));
    function updateLibraryNavBadge() {
      const badge = $('#nav-library-count');
      if (!badge) return;
      const count = getFavorites().length;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    }
    function toggleFavorite(item) {
      const list = getFavorites();
      const idx = list.findIndex(f => favKey(f) === favKey(item));
      if (idx >= 0) { list.splice(idx, 1); writeList('smartrail-favorites', list); updateLibraryNavBadge(); showToast(t('removedToast')); return false; }
      list.unshift({ code: item.code, name: item.name || '', englishName: item.englishName || '', year: item.year ?? null, status: item.status || '', source: item.source || '', savedAt: Date.now() });
      writeList('smartrail-favorites', list);
      updateLibraryNavBadge();
      showToast(t('savedToast'));
      return true;
    }
    function recordRecent(item) {
      const list = getRecent().filter(r => favKey(r) !== favKey(item));
      list.unshift({ code: item.code, name: item.name || '', englishName: item.englishName || '', year: item.year ?? null, status: item.status || '', source: item.source || '', viewedAt: Date.now() });
      writeList('smartrail-recent', list);
    }

    function orgOf(code) {
      const text = String(code || '').trim().toUpperCase();
      const match = text.match(/^(DIN EN ISO|EN ISO|DIN EN|BS EN|GB\/T|TCVN|QCVN|ISO|IEC|ASTM|BS|DIN|EN|JIS|UL|ANSI|AS|GB)\b/);
      return match ? match[1] : (text.split(' ')[0] || DASH);
    }
    function orgTone(code) {
      const text = String(code || '').trim().toUpperCase();
      if (text.startsWith('QCVN')) return 'qcvn';
      if (/^(TCVN|TCXD|TCN|TCCS)\b/.test(text)) return 'tcvn';
      return 'intl';
    }
    const SVG_ICONS = {
      CAT01: ['M2 10h20', 'M4 10v9M20 10v9M12 10v9', 'M4 19a4 4 0 0 1 8 0M12 19a4 4 0 0 1 8 0', 'M6 10V6l6-2 6 2v4'],
      CAT02: ['M13 2 4 14h7l-1 8 10-12h-7l0-8z'],
      CAT03: ['M12 2 2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
      CAT04: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
      CAT05: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
      CAT06: ['M9 3h6', 'M10 3v5l-4.5 7.5A2 2 0 0 0 7.2 18.5h9.6a2 2 0 0 0 1.7-3L14 8V3']
    };
    function iconSvg(name, size = 22) {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', String(size));
      svg.setAttribute('height', String(size));
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      for (const d of (SVG_ICONS[name] || [])) {
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', d);
        svg.append(path);
      }
      return svg;
    }
    const dash = value => (value === null || value === undefined || String(value).trim() === '' ? DASH : String(value));

    function makeBadge(value, forcedTone) {
      const badge = document.createElement('span');
      badge.className = `badge badge-${forcedTone || statusTone(value)}`;
      badge.textContent = dash(value);
      return badge;
    }

    // ---- view switching + URL state ----
    function showView(name, push = true) {
      $$('.view-panel').forEach(panel => {
        const visible = panel.id === `view-${name}`;
        panel.hidden = !visible;
        panel.classList.toggle('is-visible', visible);
      });
      $$('.nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.view === name));
      $('#main-nav').classList.remove('is-open');
      $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
      if (name === 'library') renderLibrary();
      if (name === 'documents') void loadDocumentsView();
      if (name === 'admin-users') void loadAdminUsersView();
      if (name === 'admin-tocs') void loadAdminTocsView();
      else destroyAdminTocPdf();
      if (push) {
        const url = new URL(location.href);
        if (name === 'home') { url.search = ''; } else { url.searchParams.set('view', name); if (name !== 'search') { url.searchParams.delete('q'); url.searchParams.delete('page'); } if (name !== 'detail') { url.searchParams.delete('code'); url.searchParams.delete('source'); } }
        history.replaceState(null, '', url);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function goSearch(query, page = 1) {
      searchInput.value = query;
      searchPage.value = String(page);
      showView('search', false);
      showSearchTab('standards');
      void searchStandards();
    }

    // ---- Home: recently updated (elib files, newest first) ----
    function formatDocDate(value) {
      if (!value) return DASH;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
      return date.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'vi-VN');
    }

    function formatDateTime(value) {
      if (!value) return DASH;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
      return date.toLocaleString(currentLang === 'en' ? 'en-GB' : 'vi-VN');
    }

    function fileBadge(kind) {
      const badge = document.createElement('span');
      badge.className = `file-badge file-badge-${kind}`;
      badge.textContent = { pdf: 'PDF', doc: 'DOC', xls: 'XLS', ppt: 'PPT', img: 'IMG', txt: 'TXT', dwg: 'DWG', other: 'FILE' }[kind] || 'FILE';
      badge.setAttribute('aria-hidden', 'true');
      return badge;
    }

    /**
     * Tải file qua fetch để bắt lỗi theo mã ổn định (403
     * DOWNLOAD_FORBIDDEN -> thông báo rõ, không hiện lỗi trống của
     * trình duyệt). Thành công -> tải blob với tên file từ
     * Content-Disposition (dự phòng: tên file gốc).
     */
    async function downloadFile(doc) {
      const path = elibDownloadPath(doc);
      if (!path) return;
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        if (!res.ok) {
          let code = null;
          try { code = (await res.json())?.error?.code ?? null; } catch { /* body lỗi không phải JSON */ }
          showToast(t(downloadErrorKey(res.status, code)));
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filenameFromDisposition(res.headers.get('content-disposition')) || doc.file?.original_filename || '';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        showToast(t('downloadFailed'));
      }
    }

    function appendDownloadAffordance(container, doc) {
      // Idempotent như appendPreviewAffordances: mỗi thẻ chỉ gắn một lần.
      if (container.dataset.downloadAffordance === '1') return;
      container.dataset.downloadAffordance = '1';
      const kind = downloadAffordance(doc, elibUser);
      if (kind === 'none') return;
      if (kind === 'login') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button button-secondary button-small';
        btn.textContent = t('loginToDownload');
        btn.addEventListener('click', () => showView('documents'));
        container.append(btn);
        return;
      }
      if (kind === 'contact') {
        // Đã đăng nhập nhưng không có quyền tải: gợi ý liên hệ xin
        // quyền thay cho nút tải, kèm kênh liên hệ từ ui-config
        // (cùng cấu hình ELIB_CONTACT với panel hết preview ở B2).
        const hint = document.createElement('span');
        hint.className = 'download-contact-hint';
        hint.textContent = t('downloadContactHint');
        container.append(hint);
        const contact = normalizeContact(uiConfig);
        if (contact.text || contact.url) {
          const link = document.createElement('a');
          link.className = 'download-contact-link';
          link.textContent = contact.text || contact.url;
          if (contact.url) {
            link.href = contact.url;
            link.target = '_blank';
            link.rel = 'noreferrer';
          }
          container.append(link);
        }
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button button-secondary button-small';
      btn.textContent = t('elibDownload');
      btn.addEventListener('click', () => void downloadFile(doc));
      container.append(btn);
    }

    // ---- Danh mục tài liệu: deep link, cấu hình liên hệ, đổi visibility (Giai đoạn B2) ----
    // knownDocs: tài liệu đã thấy qua danh sách (trang chủ / tìm kiếm),
    // để deep link #doc=<id> mở đúng viewer mà không cần endpoint chi tiết.
    const knownDocs = new Map();
    function rememberDoc(doc) {
      if (doc?.id) knownDocs.set(String(doc.id), doc);
    }

    // Kênh liên hệ ở panel hết preview, lấy từ env phía Reverse_proxy
    // qua GET /api/v1/ui-config (công khai, không nhạy cảm). Lỗi -> rỗng.
    let uiConfig = { elibContactText: '', elibContactUrl: '' };
    async function loadUiConfig() {
      try {
        const res = await fetch('/api/v1/ui-config', { credentials: 'same-origin' });
        if (!res.ok) return;
        const payload = await res.json();
        uiConfig = {
          elibContactText: typeof payload?.elibContactText === 'string' ? payload.elibContactText : '',
          elibContactUrl: typeof payload?.elibContactUrl === 'string' ? payload.elibContactUrl : ''
        };
      } catch { /* giữ mặc định rỗng: chỉ hiện câu chung */ }
    }

    let viewerDocId = null;
    let viewerDoc = null;
    function setDocDeepLink(id) {
      try { history.replaceState(null, '', docDeepLinkHash(id)); } catch { /* bỏ qua */ }
    }
    function clearDocDeepLink() {
      if (!parseDocDeepLink(location.hash)) return;
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* bỏ qua */ }
    }

    async function openDeepLinkedDoc(id) {
      if (!id) return;
      const known = knownDocs.get(String(id));
      if (known) { void openDocViewer(known, 'preview'); return; }
      // elib chưa có endpoint chi tiết từng tài liệu: mở viewer với id
      // tối thiểu, endpoint preview tự quyết quyền (404 thống nhất).
      void openDocViewer({ id: String(id) }, 'preview', { deepLink: true });
    }

    function openDeepLinkFromHash() {
      const id = parseDocDeepLink(location.hash);
      if (id) void openDeepLinkedDoc(id);
    }

    /** Bấm thẻ/tiêu đề -> mở viewer preview (trừ khi bấm vào nút/link/select bên trong). */
    function makeCardOpenPreview(element, doc) {
      element.classList.add('doc-card-clickable');
      element.addEventListener('click', (event) => {
        if (event.target.closest('button, a, select, input, textarea, label')) return;
        void openDocViewer(doc, 'preview');
      });
    }

    /** Ô chọn mức hiển thị cho admin/chủ tài liệu (PATCH qua proxy). */
    function appendVisibilityControl(container, doc) {
      if (!canChangeVisibility(elibUser, doc)) return;
      if (container.dataset.visibilityControl === '1') return;
      container.dataset.visibilityControl = '1';
      const wrap = document.createElement('span');
      wrap.className = 'visibility-control';
      const label = document.createElement('label');
      label.textContent = t('visibilityLabel');
      const select = document.createElement('select');
      select.className = 'visibility-select';
      select.setAttribute('aria-label', t('visibilityLabel'));
      for (const value of ['public', 'members', 'internal', 'private']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(`visibility${value[0].toUpperCase()}${value.slice(1)}`);
        select.append(option);
      }
      select.value = ['public', 'members', 'internal', 'private'].includes(doc.visibility) ? doc.visibility : 'internal';
      label.append(select);
      wrap.append(label);
      select.addEventListener('change', async () => {
        const previous = doc.visibility;
        const next = select.value;
        if (next === previous) return;
        select.disabled = true;
        const result = await elibFetchJson(`/documents/${encodeURIComponent(doc.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility: next })
        });
        select.disabled = false;
        if (result.status === 200 && result.payload?.document) {
          doc.visibility = result.payload.document.visibility;
          select.value = doc.visibility;
          showToast(t('visibilityUpdated'));
          return;
        }
        select.value = ['public', 'members', 'internal', 'private'].includes(previous) ? previous : 'internal';
        showToast(t(visibilityErrorKey(result.status ?? 0, result.errorCode || null)));
      });
      container.append(wrap);
    }

    // ---- Document preview / full viewer (Phase B) ----
    // pdf.js is lazy-loaded from /vendor/pdfjs/ only when a viewer opens;
    // it is NOT part of the initial page bundle. Preview bytes come from
    // elib's pre-cut preview PDF; the original is only fetched via /view
    // for owner+admin (can_view_full).

    function appendPreviewAffordances(container, doc) {
      // Idempotent: a card's actions container gets preview/full buttons
      // at most once, even if a renderer calls this twice by mistake.
      if (container.dataset.previewAffordances === '1') return;
      container.dataset.previewAffordances = '1';
      const aff = previewAffordance(doc);
      if (aff.showPreview) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button button-primary button-small';
        btn.textContent = t('viewPreview');
        btn.addEventListener('click', () => void openDocViewer(doc, 'preview'));
        container.append(btn);
      } else if (aff.showPreparing) {
        const span = document.createElement('span');
        span.className = 'preview-preparing';
        span.textContent = t('previewPreparing');
        container.append(span);
      }
      if (aff.showViewFull) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'button button-secondary button-small';
        btn.textContent = t('viewFull');
        btn.addEventListener('click', () => void openDocViewer(doc, aff.isImage ? 'image' : 'full'));
        container.append(btn);
      }
    }

    let pdfjsPromise = null;
    function loadPdfjs() {
      if (!pdfjsPromise) {
        // Specifier built at runtime: pdf.js is a vendored static file,
        // deliberately outside any bundler/test transform pipeline.
        const pdfjsUrl = '/vendor/pdfjs/' + 'pdf.min.mjs';
        pdfjsPromise = import(/* @vite-ignore */ pdfjsUrl).then((mod) => {
          mod.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
          return mod;
        });
      }
      return pdfjsPromise;
    }

    let viewerState = null;
    let viewerTocSeq = 0;
    let viewerTocTimer = null;
    let viewerTocState = null;
    let viewerTocOpen = false;
    let viewerEndHighlightTimer = null;

    function isMobileViewer() {
      return typeof window !== 'undefined' && window.innerWidth <= 768;
    }

    function applyTocVisibility() {
      const tocEl = $('#doc-viewer-toc');
      const toggleBtn = $('#doc-viewer-toc-toggle');
      const backdropEl = $('#doc-viewer-toc-backdrop');
      if (!tocEl || !toggleBtn || !backdropEl) return;
      if (!viewerTocState) {
        tocEl.hidden = true;
        tocEl.classList.remove('is-drawer-open');
        tocEl.removeAttribute('aria-hidden');
        toggleBtn.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
        backdropEl.hidden = true;
        return;
      }
      toggleBtn.hidden = false;
      toggleBtn.setAttribute('aria-expanded', String(viewerTocOpen));
      if (isMobileViewer()) {
        tocEl.hidden = false;
        tocEl.classList.toggle('is-drawer-open', viewerTocOpen);
        tocEl.setAttribute('aria-hidden', String(!viewerTocOpen));
        backdropEl.hidden = !viewerTocOpen;
      } else {
        tocEl.classList.remove('is-drawer-open');
        tocEl.removeAttribute('aria-hidden');
        tocEl.hidden = !viewerTocOpen;
        backdropEl.hidden = true;
      }
    }

    function resetViewerToc() {
      viewerTocSeq += 1;
      clearTimeout(viewerTocTimer);
      viewerTocTimer = null;
      viewerTocState = null;
      viewerTocOpen = false;
      const searchWrap = $('#doc-viewer-toc-search-wrap');
      const searchInput = $('#doc-viewer-toc-search');
      const statusEl = $('#doc-viewer-toc-status');
      const listEl = $('#doc-viewer-toc-list');
      const footEl = $('#doc-viewer-toc-foot');
      if (searchWrap) searchWrap.hidden = true;
      if (searchInput) searchInput.value = '';
      if (statusEl) { statusEl.hidden = true; statusEl.textContent = ''; }
      if (listEl) listEl.replaceChildren();
      if (footEl) { footEl.hidden = true; footEl.replaceChildren(); }
      applyTocVisibility();
    }

    function showPreviewAccessNotice(highlight = false) {
      const endEl = $('#doc-viewer-end');
      const endTextEl = $('#doc-viewer-end-text');
      const endLoginEl = $('#doc-viewer-end-login');
      if (!endEl || !endTextEl || !endLoginEl) return;
      const kind = endOfPreviewKind(elibUser);
      endTextEl.textContent = kind === 'login' ? t('previewEndLogin') : t('previewEndContact');
      endLoginEl.hidden = kind !== 'login';
      const contact = normalizeContact(uiConfig);
      const contactEl = $('#doc-viewer-end-contact');
      if (contactEl) {
        if (contact.text || contact.url) {
          contactEl.hidden = false;
          contactEl.textContent = contact.text || contact.url;
          if (contact.url) contactEl.href = contact.url;
          else contactEl.removeAttribute('href');
        } else {
          contactEl.hidden = true;
        }
      }
      endEl.hidden = false;
      if (highlight) {
        endEl.classList.add('is-highlighted');
        clearTimeout(viewerEndHighlightTimer);
        viewerEndHighlightTimer = setTimeout(() => {
          endEl.classList.remove('is-highlighted');
        }, 1800);
        showToast(t('tocLockedNotice'));
      }
    }

    function updateActiveTocHighlight(pageNum) {
      if (!viewerTocState || viewerTocState.kind !== 'ready') return;
      const nextId = findActiveTocNodeId(viewerTocState.tree, pageNum);
      viewerTocState.activeId = nextId;
      const listEl = $('#doc-viewer-toc-list');
      if (!listEl) return;
      for (const btn of listEl.querySelectorAll('.toc-node-btn')) {
        const isActive = Boolean(nextId && btn.getAttribute('data-toc-id') === nextId);
        btn.classList.toggle('is-active', isActive);
        if (isActive) {
          btn.setAttribute('aria-current', 'location');
        } else {
          btn.removeAttribute('aria-current');
        }
      }
    }

    function computeCurrentViewerPage() {
      const pagesEl = $('#doc-viewer-pages');
      const canvases = viewerState?.canvases;
      if (!pagesEl || !Array.isArray(canvases) || canvases.length === 0) return 1;
      const idx = canvases.findIndex((c) => c.offsetTop + c.offsetHeight > pagesEl.scrollTop + 24);
      return idx < 0 ? 1 : idx + 1;
    }

    function jumpToViewerPage(pageNum) {
      const page = Math.trunc(Number(pageNum));
      if (!Number.isFinite(page) || page < 1 || !viewerState) return;
      const canvases = viewerState.canvases;
      if (!Array.isArray(canvases) || canvases.length === 0) {
        viewerState.pendingJumpPage = page;
        viewerState.currentPage = page;
        updateActiveTocHighlight(page);
        return;
      }
      if (page > canvases.length) {
        showPreviewAccessNotice(true);
        return;
      }
      const targetCanvas = canvases[page - 1];
      if (!targetCanvas) return;
      const pagesEl = $('#doc-viewer-pages');
      viewerState.currentPage = page;
      viewerState.pinnedPage = page;
      clearTimeout(viewerState.pinTimer);
      viewerState.pinTimer = setTimeout(() => {
        if (viewerState) viewerState.pinTimer = null, viewerState.pinnedPage = null;
      }, 900);
      if (viewerState.mode !== 'preview') {
        const pageInfoEl = $('#doc-viewer-pageinfo');
        if (pageInfoEl) pageInfoEl.textContent = t('viewerPage', { n: page, total: canvases.length });
      }
      updateActiveTocHighlight(page);
      if (pagesEl) {
        pagesEl.scrollTo({ top: Math.max(0, targetCanvas.offsetTop - 8), behavior: 'smooth' });
      }
      viewerState.ensurePageRendered?.(page);
    }

    function renderViewerToc() {
      const searchWrap = $('#doc-viewer-toc-search-wrap');
      const statusEl = $('#doc-viewer-toc-status');
      const listEl = $('#doc-viewer-toc-list');
      const footEl = $('#doc-viewer-toc-foot');
      if (!searchWrap || !statusEl || !listEl || !footEl || !viewerTocState) return;

      if (viewerTocState.kind === 'processing') {
        searchWrap.hidden = true;
        listEl.replaceChildren();
        footEl.hidden = true;
        footEl.replaceChildren();
        statusEl.hidden = false;
        statusEl.textContent = t('tocProcessing');
        return;
      }

      searchWrap.hidden = false;
      const query = viewerTocState.query || '';
      const isSearching = normalizeTocSearchText(query).length > 0;
      const visibleTree = filterTocTree(viewerTocState.tree, query);
      if (visibleTree.length === 0 && isSearching) {
        listEl.replaceChildren();
        statusEl.hidden = false;
        statusEl.textContent = t('tocNoMatches');
      } else {
        statusEl.hidden = true;
        statusEl.textContent = '';
        const items = createTocListDom(document, visibleTree, {
          activeId: viewerTocState.activeId,
          collapsedIds: viewerTocState.collapsedIds,
          isSearching,
          getTotalLoadedPages: () => viewerState?.totalPages ?? null,
          labels: {
            expand: t('tocExpand'),
            collapse: t('tocCollapse'),
            lockedLabel: t('tocLockedLabel')
          },
          onToggleCollapse: (nodeId) => {
            if (!viewerTocState || viewerTocState.kind !== 'ready') return;
            if (viewerTocState.collapsedIds.has(nodeId)) viewerTocState.collapsedIds.delete(nodeId);
            else viewerTocState.collapsedIds.add(nodeId);
            renderViewerToc();
          },
          onLocked: () => {
            showPreviewAccessNotice(true);
            if (isMobileViewer()) {
              viewerTocOpen = false;
              applyTocVisibility();
            }
          },
          onJump: (page) => {
            jumpToViewerPage(page);
            if (isMobileViewer()) {
              viewerTocOpen = false;
              applyTocVisibility();
            }
          }
        });
        listEl.replaceChildren(...items);
      }

      const footKeys = tocFooterKeys(viewerTocState);
      footEl.replaceChildren();
      for (const key of footKeys) {
        const badge = document.createElement('span');
        badge.className = 'toc-foot-badge';
        badge.textContent = t(key);
        footEl.append(badge);
      }
      footEl.hidden = footKeys.length === 0;
    }

    async function loadViewerToc(doc, options, seq, retryCount = 0) {
      const tocPath = elibTocPath(doc, options?.fileId);
      if (!tocPath) {
        resetViewerToc();
        return;
      }
      const result = await elibFetchJson(tocPath.replace(/^\/api\/elib/, ''));
      if (seq !== viewerTocSeq || $('#doc-viewer')?.hidden) return;

      const nextState = resolveTocViewState(result);
      if (nextState.kind === 'hidden') {
        resetViewerToc();
        return;
      }
      if (nextState.kind === 'processing') {
        const wasOpen = Boolean(viewerTocState);
        viewerTocState = { kind: 'processing' };
        if (!wasOpen) viewerTocOpen = !isMobileViewer();
        renderViewerToc();
        applyTocVisibility();
        if (shouldPollToc(nextState, retryCount)) {
          viewerTocTimer = setTimeout(() => {
            void loadViewerToc(doc, options, seq, retryCount + 1);
          }, TOC_POLL_INTERVAL_MS);
        }
        return;
      }

      const tree = buildTocTree(nextState.nodes, {
        previewOnly: nextState.previewOnly,
        firstPageLabel: t('tocFirstPage')
      });
      if (tree.length === 0) {
        resetViewerToc();
        return;
      }
      const wasOpen = Boolean(viewerTocState);
      if (!wasOpen) viewerTocOpen = !isMobileViewer();
      viewerTocState = {
        ...nextState,
        tree,
        query: '',
        collapsedIds: new Set(),
        activeId: findActiveTocNodeId(tree, viewerState?.currentPage || 1)
      };
      renderViewerToc();
      applyTocVisibility();
    }

    function closeDocViewer() {
      const overlay = $('#doc-viewer');
      if (overlay) overlay.hidden = true;
      viewerDocId = null;
      viewerDoc = null;
      clearDocDeepLink();
      resetViewerToc();
      clearTimeout(viewerEndHighlightTimer);
      viewerEndHighlightTimer = null;
      const endEl = $('#doc-viewer-end');
      if (endEl) endEl.classList.remove('is-highlighted');
      if (viewerState?.pinTimer) clearTimeout(viewerState.pinTimer);
      if (viewerState?.scrollRaf) cancelAnimationFrame(viewerState.scrollRaf);
      if (viewerState?.observer) viewerState.observer.disconnect();
      if (viewerState?.loadingTask) {
        // Release pdf.js resources (worker document + rendered pages).
        viewerState.loadingTask.destroy().catch(() => undefined);
      }
      if (viewerState?.objectUrl) URL.revokeObjectURL(viewerState.objectUrl);
      viewerState = null;
      const pages = $('#doc-viewer-pages');
      if (pages) pages.replaceChildren();
      const img = $('#doc-viewer-img');
      if (img) img.removeAttribute('src');
    }

    async function fetchDocBytes(url) {
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) {
        let code = null;
        try {
          const payload = await res.json();
          code = payload?.error?.code ?? null;
        } catch { /* non-JSON error body */ }
        const err = new Error('preview fetch failed');
        err.status = res.status;
        err.code = code;
        throw err;
      }
      return res.arrayBuffer();
    }

    async function openDocViewer(doc, mode, options = {}) {
      const overlay = $('#doc-viewer');
      const pagesEl = $('#doc-viewer-pages');
      const imgEl = $('#doc-viewer-img');
      const statusEl = $('#doc-viewer-status');
      const titleEl = $('#doc-viewer-title');
      const pageInfoEl = $('#doc-viewer-pageinfo');
      const endEl = $('#doc-viewer-end');
      const aff = previewAffordance(doc);
      closeDocViewer();
      viewerDoc = doc || null;
      viewerDocId = doc?.id ? String(doc.id) : null;
      if (viewerDocId) setDocDeepLink(viewerDocId);
      overlay.hidden = false;
      titleEl.textContent = doc.title || doc.file?.original_filename || '';
      endEl.hidden = true;
      imgEl.hidden = mode !== 'image';
      pagesEl.hidden = mode === 'image';
      // Download/print chỉ hiện ở chế độ toàn bộ khi có quyền tương
      // ứng (can_download / can_view_full); xem trước luôn ẩn cả hai.
      const toolbar = viewerToolbar(doc, mode);
      $('#doc-viewer-download').hidden = !toolbar.showDownload;
      $('#doc-viewer-print').hidden = !toolbar.showPrint;
      const downloadPath = elibDownloadPath(doc);
      $('#doc-viewer-download').href = downloadPath || '#';
      const viewUrl = elibViewPath(doc);
      $('#doc-viewer-print').href = viewUrl || '#';
      if (mode === 'preview' && aff.previewPages && aff.pageCount) {
        pageInfoEl.textContent = t('previewOfPages', { x: aff.previewPages, y: aff.pageCount });
      } else {
        pageInfoEl.textContent = '';
      }
      statusEl.hidden = false;
      statusEl.classList.remove('viewer-error');

      // Trạng thái không có preview (pending/failed/unsupported/1 trang):
      // hiện thông báo rõ ngay trong viewer, không gọi endpoint, không lỗi trống.
      if (mode === 'preview') {
        const stateKey = previewStateKey(doc);
        if (stateKey) {
          statusEl.textContent = t(stateKey);
          return;
        }
      }
      statusEl.textContent = t('viewerLoading');

      try {
        if (mode === 'image') {
          // Simple image viewer for owner/admin full view.
          const res = await fetch(viewUrl, { credentials: 'same-origin' });
          if (!res.ok) {
            let code = null;
            try { code = (await res.json())?.error?.code ?? null; } catch { /* ignore */ }
            const err = new Error('image fetch failed');
            err.status = res.status; err.code = code;
            throw err;
          }
          const blob = await res.blob();
          imgEl.src = URL.createObjectURL(blob);
          viewerState = { objectUrl: imgEl.src };
          statusEl.hidden = true;
          return;
        }

        viewerState = {
          loadingTask: null,
          doc,
          mode,
          canvases: [],
          totalPages: 0,
          currentPage: 1,
          pendingJumpPage: null,
          pinnedPage: null,
          pinTimer: null,
          scrollRaf: 0
        };
        const tocSeq = ++viewerTocSeq;
        void loadViewerToc(doc, options, tocSeq, 0);

        const pdfjs = await loadPdfjs();
        const url = mode === 'preview' ? elibPreviewPath(doc) : viewUrl;
        let loadingTask;
        if (mode === 'preview') {
          // Preview PDFs are small (a few pages): fetch bytes so HTTP
          // error codes map cleanly before pdf.js sees anything.
          const data = await fetchDocBytes(url);
          loadingTask = pdfjs.getDocument({
            data,
            isEvalSupported: false,
            standardFontDataUrl: '/vendor/pdfjs/standard_fonts/'
          });
        } else {
          // Full view can be large: preflight with a 1-byte Range request
          // for error mapping, then let pdf.js stream via Range.
          const probe = await fetch(url, { credentials: 'same-origin', headers: { Range: 'bytes=0-0' } });
          if (!probe.ok && probe.status !== 206) {
            let code = null;
            try { code = (await probe.json())?.error?.code ?? null; } catch { /* ignore */ }
            const err = new Error('view fetch failed');
            err.status = probe.status; err.code = code;
            throw err;
          }
          loadingTask = pdfjs.getDocument({
            url,
            isEvalSupported: false,
            standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
            withCredentials: true
          });
        }
        if (!viewerState || overlay.hidden) {
          loadingTask.destroy().catch(() => undefined);
          return;
        }
        viewerState.loadingTask = loadingTask;
        const pdf = await loadingTask.promise;
        if (!viewerState || viewerState.loadingTask !== loadingTask) return;
        statusEl.hidden = true;
        const total = pdf.numPages;
        viewerState.totalPages = total;
        if (mode !== 'preview') {
          pageInfoEl.textContent = t('viewerPage', { n: 1, total });
        }
        const firstPage = total >= 1 ? await pdf.getPage(1) : null;
        if (!viewerState || viewerState.loadingTask !== loadingTask) return;
        const firstViewport = firstPage ? firstPage.getViewport({ scale: 1.5 }) : null;

        const canvases = [];
        for (let n = 1; n <= total; n += 1) {
          const canvas = document.createElement('canvas');
          canvas.className = 'viewer-page';
          canvas.dataset.page = String(n);
          if (firstViewport) {
            canvas.style.width = `${firstViewport.width}px`;
            canvas.style.aspectRatio = `${firstViewport.width} / ${firstViewport.height}`;
          }
          pagesEl.append(canvas);
          canvases.push(canvas);
        }
        viewerState.canvases = canvases;

        const renderedPromises = new Map();
        let observer = null;
        const ensurePageRendered = (pageNum) => {
          if (renderedPromises.has(pageNum)) return renderedPromises.get(pageNum);
          const canvas = canvases[pageNum - 1];
          if (!canvas) return Promise.resolve();
          observer?.unobserve(canvas);
          const p = (async () => {
            if (!viewerState || viewerState.loadingTask !== loadingTask) return;
            const page = pageNum === 1 && firstPage ? firstPage : await pdf.getPage(pageNum);
            if (!viewerState || viewerState.loadingTask !== loadingTask) return;
            const viewport = page.getViewport({ scale: 1.5 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            if (viewerState && viewerState.loadingTask === loadingTask && viewerState.pinnedPage === pageNum) {
              pagesEl.scrollTop = Math.max(0, canvas.offsetTop - 8);
            }
          })().catch(() => {
            renderedPromises.delete(pageNum);
          });
          renderedPromises.set(pageNum, p);
          return p;
        };
        viewerState.ensurePageRendered = ensurePageRendered;

        observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target;
            observer.unobserve(canvas);
            void ensurePageRendered(Number(canvas.dataset.page));
          }
        }, { root: pagesEl, rootMargin: '400px' });
        canvases.forEach((c) => observer.observe(c));
        if (viewerState) viewerState.observer = observer;

        if (mode === 'preview') {
          // End-of-preview panel: no scrolling past the cut pages exists
          // (the preview PDF simply has no more pages). Contact channel
          // comes from /api/v1/ui-config (env phía Reverse_proxy);
          // empty config -> generic sentence only. No price is shown.
          showPreviewAccessNotice(false);
        }

        if (viewerState.pendingJumpPage) {
          const targetPage = viewerState.pendingJumpPage;
          viewerState.pendingJumpPage = null;
          jumpToViewerPage(targetPage);
        } else {
          updateActiveTocHighlight(viewerState.currentPage || 1);
        }
      } catch (error) {
        resetViewerToc();
        statusEl.hidden = false;
        statusEl.classList.add('viewer-error');
        if (options.deepLink && error?.status === 404) {
          // Deep link tới tài liệu không có quyền thấy (elib trả 404
          // thống nhất): thông báo rõ, không lộ nội dung; chưa đăng
          // nhập thì gợi ý đăng nhập qua panel cuối.
          statusEl.textContent = t('docNoAccess');
          if (!elibUser) {
            $('#doc-viewer-end-text').textContent = t('previewEndLogin');
            $('#doc-viewer-end-login').hidden = false;
            endEl.hidden = false;
          }
        } else {
          statusEl.textContent = t(previewErrorKey(error?.status ?? 0, error?.code ?? null));
        }
      }
    }

    let homeRecentLoaded = false;
    async function loadHomeRecent() {
      const list = $('#home-recent-list');
      const state = $('#home-recent-state');
      const skeleton = $('#home-recent-skeleton');
      if (!list || !state) return;
      if (skeleton) skeleton.hidden = false;
      state.hidden = true;
      list.replaceChildren();
      const result = await elibFetchJson('/documents?limit=6&offset=0');
      homeRecentLoaded = true;
      if (skeleton) skeleton.hidden = true;
      if (result.status !== 200 || !result.payload || !Array.isArray(result.payload.data)) {
        state.hidden = false;
        state.textContent = t('recentError');
        return;
      }
      const records = result.payload.data;
      if (records.length === 0) {
        state.hidden = false;
        state.textContent = t('recentEmpty');
        return;
      }
      state.hidden = true;
      for (const doc of records) {
        rememberDoc(doc);
        const row = document.createElement('div');
        row.className = 'recent-row recent-file-row';
        const kind = fileKindFromName(doc.file?.original_filename, doc.file?.mime_type);
        const main = document.createElement('span');
        main.className = 'recent-main';
        const strong = document.createElement('strong');
        strong.textContent = dash(doc.title);
        const small = document.createElement('small');
        small.textContent = [doc.file?.original_filename, formatDocDate(doc.created_at), doc.file ? formatBytes(doc.file.file_size) : ''].filter(Boolean).join(' · ');
        main.append(strong, small);
        const actions = document.createElement('span');
        actions.className = 'recent-file-actions';
        appendPreviewAffordances(actions, doc);
        appendDownloadAffordance(actions, doc);
        appendVisibilityControl(actions, doc);
        row.append(fileBadge(kind), main, actions);
        makeCardOpenPreview(row, doc);
        list.append(row);
      }
    }

    // ---- Categories ----
    function renderCategories() {
      const grid = $('#categories-grid');
      grid.replaceChildren();
      for (const cat of CATEGORIES) {
        const card = document.createElement('article');
        card.className = 'category-card';
        card.dataset.cat = cat.id;
        const banner = document.createElement('div');
        banner.className = 'category-banner';
        const catId = document.createElement('span');
        catId.textContent = cat.id;
        banner.append(catId, iconSvg(cat.id, 26));
        const body = document.createElement('div');
        body.className = 'category-body';
        const h3 = document.createElement('h3');
        h3.textContent = currentLang === 'en' ? cat.en : cat.vi;
        const en = document.createElement('p');
        en.className = 'category-en';
        en.textContent = currentLang === 'en' ? cat.vi : cat.en;
        const count = document.createElement('span');
        count.className = 'category-count';
        count.dataset.catCount = cat.id;
        count.textContent = t('loading');
        const subs = document.createElement('ul');
        subs.className = 'category-subs';
        for (const sub of cat.subs) {
          const li = document.createElement('li');
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = `${currentLang === 'en' ? sub.en : sub.vi} ›`;
          btn.addEventListener('click', () => goSearch(sub.query));
          li.append(btn);
          subs.append(li);
        }
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'button button-secondary button-small category-open';
        open.textContent = t('openCategory');
        open.addEventListener('click', () => goSearch(cat.query));
        body.append(h3, en, count, subs, open);
        card.append(banner, body);
        grid.append(card);
      }
      void loadCategoryCounts();
    }

    async function loadCategoryCounts() {
      await Promise.allSettled(CATEGORIES.map(async cat => {
        const el = document.querySelector(`[data-cat-count="${cat.id}"]`);
        const result = await fetchApi(`/api/v1/standards/search?${new URLSearchParams({ q: cat.query, page: '1' })}`);
        if (!el) return;
        const total = result.ok ? result.payload?.pagination?.totalResults : undefined;
        el.textContent = Number.isInteger(total) ? `${total.toLocaleString()} ${t('documents')}` : t('countUnavailable');
      }));
    }

    // ---- Search ----
    let lastSearchPayload = null;
    let resultsViewMode = 'list';

    function currentFilters() {
      return {
        sources: new Set($$('.filter-source').filter(cb => cb.checked).map(cb => cb.value)),
        year: $('#filter-year').value ? Number($('#filter-year').value) : null,
        status: $('#filter-status').value || ''
      };
    }

    function updateFilterBadge(filters) {
      const badge = $('#filter-active-badge');
      if (!badge) return;
      const totalSources = $$('.filter-source').length || 3;
      const activeCount = (filters.sources.size < totalSources ? 1 : 0) + (filters.year ? 1 : 0) + (filters.status ? 1 : 0);
      badge.hidden = activeCount === 0;
      if (activeCount > 0) badge.textContent = t('activeFilters', { n: activeCount });
    }

    function applyFiltersAndRender() {
      const container = $('#search-results');
      const empty = $('#search-empty');
      container.replaceChildren();
      container.classList.toggle('is-grid', resultsViewMode === 'grid');
      const filters = currentFilters();
      updateFilterBadge(filters);
      if (!lastSearchPayload || !Array.isArray(lastSearchPayload.data)) return;
      let records = lastSearchPayload.data.filter(record => {
        if (record.source && !filters.sources.has(record.source)) return false;
        if (filters.year && Number(record.year) !== filters.year) return false;
        if (filters.status && statusTone(record.status) !== filters.status) return false;
        return true;
      });
      const sort = $('#sort-select').value;
      if (sort === 'newest') records = [...records].sort((a, b) => (b.year || 0) - (a.year || 0));
      if (sort === 'title') records = [...records].sort((a, b) => String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'vi'));
      empty.hidden = records.length !== 0;
      if (records.length === 0) {
        empty.querySelector('strong').textContent = t(lastSearchPayload.data.length === 0 ? 'noResults' : 'filteredOut');
        empty.querySelector('p').textContent = t('noResultsHint');
        return;
      }
      for (const record of records) {
        const card = document.createElement('article');
        card.className = 'result-card';
        const cover = document.createElement('div');
        cover.className = `result-cover tone-${orgTone(record.code)}`;
        const org = document.createElement('span');
        org.className = 'cover-org-mini';
        org.textContent = orgOf(record.code);
        const mini = document.createElement('span');
        mini.className = 'cover-code-mini';
        mini.textContent = dash(record.code);
        cover.append(org, mini);
        const body = document.createElement('div');
        body.className = 'result-body';
        const codeBtn = document.createElement('button');
        codeBtn.type = 'button';
        codeBtn.className = 'result-code result-code-btn';
        codeBtn.textContent = dash(record.code);
        codeBtn.addEventListener('click', () => openDetail(record.code, record.source, record));
        const name = document.createElement('p');
        name.className = 'result-name';
        name.textContent = dash(record.name);
        body.append(codeBtn, name);
        if (record.englishName) {
          const english = document.createElement('p');
          english.className = 'result-english';
          english.textContent = record.englishName;
          body.append(english);
        }
        const chips = document.createElement('div');
        chips.className = 'meta-chips';
        if (record.year) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = `${t('yearLabel')}: ${record.year}`; chips.append(c); }
        if (record.status) chips.append(makeBadge(record.status));
        if (record.source) { const c = document.createElement('span'); c.className = 'chip chip-source'; c.textContent = record.source; chips.append(c); }
        body.append(chips);
        const actions = document.createElement('div');
        actions.className = 'result-actions';
        const detailBtn = document.createElement('button');
        detailBtn.type = 'button';
        detailBtn.className = 'detail-btn';
        detailBtn.textContent = `${t('viewDetail')} →`;
        detailBtn.addEventListener('click', () => openDetail(record.code, record.source, record));
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'save-btn';
        const syncSave = () => { const saved = isFavorite(record); saveBtn.classList.toggle('is-saved', saved); saveBtn.textContent = saved ? t('savedLibrary') : t('saveLibrary'); };
        syncSave();
        saveBtn.addEventListener('click', () => { toggleFavorite(record); syncSave(); });
        actions.append(detailBtn, saveBtn);
        card.append(cover, body, actions);
        container.append(card);
      }
    }

    function renderSearchResult(result) {
      $('#search-skeleton').hidden = true;
      const count = $('#search-result-count');
      const errorBox = $('#search-error');
      const breakdown = $('#search-sources-breakdown');
      const partial = $('#partial-failures');
      const pagination = $('#pagination-bar');
      errorBox.hidden = !result.errorMessage;
      errorBox.textContent = result.errorMessage ? `${t('requestFailed')}: ${result.errorMessage}` : '';
      breakdown.replaceChildren();
      breakdown.hidden = true;
      partial.hidden = true;
      if (!result.ok || !result.payload || !Array.isArray(result.payload.data)) {
        lastSearchPayload = null;
        count.textContent = t('requestFailed');
        pagination.hidden = true;
        $('#search-results').replaceChildren();
        const empty = $('#search-empty');
        empty.hidden = false;
        empty.querySelector('strong').textContent = result.errorMessage || t('requestFailed');
        empty.querySelector('p').textContent = t('noResultsHint');
        return;
      }
      lastSearchPayload = result.payload;
      const total = result.payload.pagination?.totalResults;
      count.textContent = Number.isInteger(total) ? t('resultsFound', { n: total.toLocaleString() }) : t('showingPage', { n: result.payload.data.length });
      if (Array.isArray(result.payload.sources) && result.payload.sources.length > 0) {
        breakdown.hidden = false;
        for (const source of result.payload.sources) {
          const chip = document.createElement('span');
          chip.className = `source-chip${source.ok ? '' : ' is-failed'}`;
          chip.textContent = source.ok ? `${source.source}: ${Number.isInteger(source.totalResults) ? source.totalResults.toLocaleString() : DASH}` : t('sourceFailed', { source: source.source });
          breakdown.append(chip);
        }
      }
      if (Array.isArray(result.payload.partialFailures) && result.payload.partialFailures.length > 0) {
        partial.hidden = false;
        partial.textContent = t('partialFail', { list: result.payload.partialFailures.join(', ') });
      }
      const pageData = result.payload.pagination || {};
      const currentPage = Number.isInteger(pageData.currentPage) ? pageData.currentPage : Number(searchPage.value) || 1;
      searchPage.value = String(currentPage);
      $('#pagination-summary').textContent = Number.isInteger(total) ? t('totalResults', { n: total.toLocaleString() }) : '';
      $('#pagination-current').textContent = Number.isInteger(pageData.totalPages) ? t('pageOfTotal', { page: currentPage, total: pageData.totalPages }) : t('pageOf', { page: currentPage });
      $('#previous-page').disabled = currentPage <= 1;
      $('#next-page').disabled = Number.isInteger(pageData.totalPages) ? currentPage >= pageData.totalPages : result.payload.data.length === 0;
      pagination.hidden = false;
      applyFiltersAndRender();
    }

    async function searchStandards() {
      const rawQuery = searchInput.value.trim();
      const page = Math.max(1, Math.min(1000, Number(searchPage.value) || 1));
      searchPage.value = String(page);
      if (rawQuery.length < 2) { showToast(t('enterQuery')); searchInput.focus(); return; }
      const orgExtra = $('#adv-org').value.trim();
      const query = orgExtra && !rawQuery.toLowerCase().includes(orgExtra.toLowerCase()) ? `${orgExtra} ${rawQuery}`.slice(0, 120) : rawQuery;
      const advSource = $('#adv-source').value;
      if (advSource) $$('.filter-source').forEach(cb => { cb.checked = cb.value === advSource; });
      const advYear = $('#adv-year').value;
      if (advYear) $('#filter-year').value = advYear;
      searchInput.value = rawQuery;
      const url = new URL(location.href);
      url.searchParams.set('view', 'search');
      url.searchParams.set('q', rawQuery);
      url.searchParams.set('page', String(page));
      history.replaceState(null, '', url);
      $('#search-empty').hidden = true;
      $('#search-results').replaceChildren();
      $('#pagination-bar').hidden = true;
      $('#search-skeleton').hidden = false;
      $('#search-result-count').textContent = t('loading');
      const submit = $('#search-submit');
      submit.disabled = true;
      submit.classList.add('is-loading');
      const params = new URLSearchParams({ q: query, page: String(page) });
      const result = await fetchApi(`/api/v1/standards/search?${params}`);
      submit.disabled = false;
      submit.classList.remove('is-loading');
      memory.search = result;
      updateInspector('search', result);
      renderRaw('search', result.raw);
      renderSearchResult(result);
    }

    // ---- Detail ----
    let currentDetail = null;
    // Dữ liệu tóm tắt của kết quả tìm kiếm vừa bấm (chỉ giữ trong
    // phiên, theo đúng mã): dùng cho trang chi tiết tóm tắt khi API
    // chi tiết lỗi. Mở trực tiếp bằng liên kết/mã gõ tay thì null.
    let pendingSummary = null;
    let currentDetailIsSummary = false;

    function appendMetaField(target, item) {
      const field = document.createElement('div');
      field.className = 'meta-field';
      const label = document.createElement('span');
      label.className = 'meta-field-label';
      label.textContent = item.label || 'Attribute';
      const value = document.createElement('span');
      value.className = 'meta-field-value';
      if (hasValue(item.value)) value.textContent = String(item.value);
      else { value.textContent = DASH; value.classList.add('is-missing'); }
      field.append(label, value);
      target.append(field);
    }

    function appendScopeEntry(target, item) {
      const block = document.createElement('div');
      block.className = 'scope-block';
      const label = document.createElement('span');
      label.className = 'scope-label';
      label.textContent = item.label || t('scope');
      const text = document.createElement('p');
      text.className = 'scope-text';
      if (hasValue(item.value)) text.textContent = String(item.value);
      else { text.textContent = DASH; text.classList.add('is-missing'); }
      block.append(label, text);
      target.append(block);
    }

    function appendRelationEntry(target, entry) {
      const item = document.createElement('li');
      item.className = 'relation-item';
      if (entry.code) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'relation-open';
        btn.textContent = entry.text || entry.code;
        btn.addEventListener('click', () => openDetail(entry.code));
        item.append(btn);
        if (entry.url) {
          const link = document.createElement('a');
          link.className = 'relation-link';
          link.href = entry.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = '↗';
          item.append(link);
        }
      } else if (entry.url) {
        const link = document.createElement('a');
        link.className = 'relation-link';
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = entry.text || DASH;
        item.append(link);
      } else {
        const text = document.createElement('span');
        text.textContent = entry.text || DASH;
        if (!entry.text) text.classList.add('is-missing');
        item.append(text);
      }
      if (entry.status) item.append(makeBadge(entry.status.text, entry.status.tone));
      target.append(item);
    }

    function renderDetailResult(result) {
      $('#detail-skeleton').hidden = true;
      const empty = $('#detail-empty');
      const groups = $('#detail-groups');
      const errorBox = $('#detail-error');
      const summaryNote = $('#detail-summary-note');
      const requestedCode = detailInput.value;
      // Trang tóm tắt: API chi tiết 404/lỗi nhưng trang được mở từ
      // một kết quả tìm kiếm của đúng mã này -> render từ dữ liệu
      // tóm tắt (memory.detail vẫn giữ response lỗi gốc, không lưu
      // tóm tắt như chi tiết thật). Không có tóm tắt (mở trực tiếp)
      // thì giữ nguyên hành vi lỗi cũ.
      let data = (result.ok && result.payload?.data && typeof result.payload.data === 'object')
        ? result.payload.data
        : null;
      let isSummary = false;
      if (!data) {
        const fallback = resolveSummaryFallback(result, pendingSummary, requestedCode);
        if (fallback) { data = fallback; isSummary = true; }
      }
      let model = data ? buildDetailViewModel(data) : null;
      if (data && model.isEmpty && !isSummary && summaryMatchesCode(pendingSummary, requestedCode)) {
        const fallback = buildSummaryDetail(pendingSummary);
        if (fallback) { data = fallback; isSummary = true; model = buildDetailViewModel(data); }
      }
      // Ở chế độ tóm tắt, ghi chú tóm tắt thay cho banner lỗi đỏ.
      errorBox.hidden = isSummary ? true : !result.errorMessage;
      errorBox.textContent = result.errorMessage ? `${t('requestFailed')}: ${result.errorMessage}` : '';
      groups.hidden = true;
      empty.hidden = false;
      currentDetail = null;
      currentDetailIsSummary = false;
      if (summaryNote) summaryNote.hidden = true;
      hideManualSection();
      if (!data) {
        empty.querySelector('strong').textContent = result.errorMessage || t('requestFailed');
        empty.querySelector('p').textContent = t('detailEmptyText');
        return;
      }
      currentDetail = data;
      currentDetailIsSummary = isSummary;
      if (model.isEmpty) {
        empty.querySelector('strong').textContent = t('noResults');
        return;
      }
      $('#detail-breadcrumb-code').textContent = model.header.code || DASH;
      const detailCover = $('.detail-cover');
      if (detailCover) {
        detailCover.classList.remove('tone-tcvn', 'tone-qcvn', 'tone-intl');
        detailCover.classList.add(`tone-${orgTone(model.header.code)}`);
      }
      $('#detail-cover-org').textContent = orgOf(model.header.code);
      $('#detail-cover-code').textContent = model.header.code || DASH;
      $('#detail-cover-name').textContent = model.header.titleVi || model.header.titleEn || '';
      const type = $('#detail-type');
      type.textContent = model.header.type || '';
      type.hidden = !model.header.type;
      const year = $('#detail-year');
      year.textContent = model.header.year ? `${t('yearPrefix')} ${model.header.year}` : '';
      year.hidden = !model.header.year;
      $('#detail-page-title').textContent = model.header.code || t('getDetail');
      const titleVi = $('#detail-title-vi');
      titleVi.textContent = model.header.titleVi || '';
      titleVi.hidden = !model.header.titleVi;
      const titleEn = $('#detail-title-en');
      titleEn.textContent = model.header.titleEn || '';
      titleEn.hidden = !model.header.titleEn;
      const statusHost = $('#detail-status-badge');
      statusHost.replaceChildren();
      if (model.header.status) {
        statusHost.className = `badge badge-${model.header.status.tone}`;
        statusHost.textContent = model.header.status.text;
        statusHost.hidden = false;
      } else statusHost.hidden = true;
      const sourceBadge = $('#detail-source-badge');
      sourceBadge.textContent = data.source || '';
      sourceBadge.hidden = !data.source;
      const dbBadge = $('#detail-db-badge');
      const fromDb = model.db?.servedFrom === 'db';
      dbBadge.textContent = fromDb ? t('fromDb') : '';
      dbBadge.hidden = !fromDb;
      const staleWarning = $('#detail-stale-warning');
      const showStale = model.db?.stale === true;
      staleWarning.textContent = showStale
        ? t('staleWarning', { days: model.db.staleDays ?? '' })
        : '';
      staleWarning.hidden = !showStale;
      if (summaryNote) {
        summaryNote.textContent = isSummary ? t('summaryNote') : '';
        summaryNote.hidden = !isSummary;
      }

      const metaRows = $('#detail-meta-rows');
      metaRows.replaceChildren();
      const rows = [
        [t('issuingAgency'), data.issuingAgency],
        [t('codeLabel'), model.header.code],
        [t('issuedDate'), data.issuedDate],
        [t('effectiveDate'), data.effectiveDate],
        [t('yearLabel'), data.year ?? model.header.year],
        [t('statusLabel'), data.status ?? model.header.status?.text],
        [t('replaces'), data.replaces],
        [t('replacedBy'), data.replacedBy],
        [t('sourceLabel'), data.source],
        ...(model.db?.lastVerifiedAt
          ? [[t('lastChecked'), formatDateTime(model.db.lastVerifiedAt)]]
          : [])
      ];
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'meta-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = dash(value);
        if (dash(value) === DASH) dd.classList.add('is-missing');
        row.append(dt, dd);
        metaRows.append(row);
      }

      const sourceLink = $('#detail-source-link');
      const safeDetailUrl = safeWebUrl(data.detailUrl);
      // The TCVN front-api detailUrl is a JSON API endpoint, not a
      // public page — never present it as "view at source"; the
      // fallback links (VSQI / ISO OBP / Google) take its place.
      const isTcvnApiUrl = (() => {
        if (!safeDetailUrl) return false;
        try { return new URL(safeDetailUrl).host === 'tracuu.tcvn.vn'; } catch { return false; }
      })();
      const showSourceLink = Boolean(safeDetailUrl) && !isTcvnApiUrl;
      sourceLink.hidden = !showSourceLink;
      if (showSourceLink) sourceLink.href = safeDetailUrl;
      const fallbackHost = $('#detail-fallback-links');
      fallbackHost.replaceChildren();
      const fallbackLabels = { vsqi: 'viewAtSource', 'iso-obp': 'searchIsoObp', google: 'searchGoogle' };
      for (const link of model.fallbackLinks || []) {
        const anchor = document.createElement('a');
        anchor.className = 'button button-secondary';
        anchor.href = link.url;
        anchor.target = '_blank';
        anchor.rel = 'noreferrer';
        anchor.textContent = t(fallbackLabels[link.kind] || 'viewAtSource');
        fallbackHost.append(anchor);
      }
      fallbackHost.hidden = (model.fallbackLinks || []).length === 0;
      const saveBtn = $('#detail-save-btn');
      const saveLabel = saveBtn.querySelector('.btn-label') || saveBtn;
      const syncSave = () => {
        const saved = isFavorite(data);
        saveBtn.classList.toggle('is-saved', saved);
        saveLabel.textContent = saved ? t('savedLibrary') : t('saveLibrary');
      };
      syncSave();
      saveBtn.onclick = () => { toggleFavorite(data); syncSave(); };
      $('#detail-copy-btn').onclick = async () => {
        const link = new URL(location.origin + '/');
        link.searchParams.set('view', 'detail');
        link.searchParams.set('code', data.code || model.header.code || '');
        if (data.source) link.searchParams.set('source', data.source);
        try { await navigator.clipboard.writeText(link.href); showToast(t('copied')); } catch { showToast(t('copyFailed')); }
      };
      $('#detail-preview-btn').onclick = () => openPreview(data, model);

      const generalGrid = $('#detail-general-grid');
      generalGrid.replaceChildren();
      model.general.forEach(item => appendMetaField(generalGrid, item));
      $('#detail-general-section').hidden = model.general.length === 0;
      const scopeList = $('#detail-scope-list');
      scopeList.replaceChildren();
      model.scope.forEach(item => appendScopeEntry(scopeList, item));
      $('#detail-scope-section').hidden = model.scope.length === 0;
      const relatedGroups = $('#detail-related-groups');
      relatedGroups.replaceChildren();
      model.related.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'relation-group';
        const heading = document.createElement('h4');
        heading.className = 'relation-group-title';
        heading.textContent = group.label;
        const list = document.createElement('ul');
        list.className = 'relation-list';
        group.entries.forEach(entry => appendRelationEntry(list, entry));
        wrapper.append(heading);
        if (group.intro) {
          const intro = document.createElement('p');
          intro.className = 'relation-intro';
          intro.textContent = group.intro;
          wrapper.append(intro);
        }
        wrapper.append(list);
        relatedGroups.append(wrapper);
      });
      $('#detail-related-section').hidden = model.related.length === 0;
      const timeline = $('#detail-timeline');
      timeline.replaceChildren();
      model.history.forEach(entry => {
        const item = document.createElement('li');
        const tone = entry.active === true ? 'active' : entry.active === false ? 'withdrawn' : statusTone(entry.status);
        item.className = `timeline-entry is-${tone}`;
        const marker = document.createElement('span');
        marker.className = 'timeline-marker';
        marker.setAttribute('aria-hidden', 'true');
        const card = document.createElement('div');
        card.className = 'timeline-card';
        const head = document.createElement('div');
        head.className = 'timeline-head';
        if (entry.code) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'relation-open timeline-code';
          btn.textContent = entry.code;
          btn.addEventListener('click', () => openDetail(entry.code));
          head.append(btn);
        } else {
          const code = document.createElement('span');
          code.className = 'timeline-code';
          code.textContent = entry.text || t('history');
          head.append(code);
        }
        if (entry.status) head.append(makeBadge(entry.status, statusTone(entry.status)));
        card.append(head);
        if (entry.note) {
          const note = document.createElement('p');
          note.className = 'timeline-note';
          note.textContent = entry.note;
          card.append(note);
        }
        item.append(marker, card);
        timeline.append(item);
      });
      $('#detail-history-section').hidden = model.history.length === 0;
      const otherGrid = $('#detail-other-grid');
      otherGrid.replaceChildren();
      model.other.forEach(item => appendMetaField(otherGrid, item));
      $('#detail-other-section').hidden = model.other.length === 0;
      const sourceBox = $('#detail-source');
      const sourceBody = $('#detail-source-body');
      sourceBody.replaceChildren();
      if (model.source) {
        const websiteRow = document.createElement('div');
        websiteRow.className = 'source-row';
        const websiteLabel = document.createElement('span');
        websiteLabel.className = 'source-label';
        websiteLabel.textContent = t('sourceLabel');
        const websiteValue = document.createElement('span');
        websiteValue.className = 'source-value';
        websiteValue.textContent = model.source.website + (model.source.host ? ` · ${model.source.host}` : '');
        websiteRow.append(websiteLabel, websiteValue);
        const urlRow = document.createElement('div');
        urlRow.className = 'source-row';
        const urlLabel = document.createElement('span');
        urlLabel.className = 'source-label';
        urlLabel.textContent = 'URL';
        const urlValue = document.createElement('span');
        urlValue.className = 'source-value';
        if (model.source.url) {
          const link = document.createElement('a');
          link.href = model.source.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = model.source.url;
          urlValue.append(link);
        } else { urlValue.textContent = DASH; urlValue.classList.add('is-missing'); }
        urlRow.append(urlLabel, urlValue);
        sourceBody.append(websiteRow, urlRow);
        sourceBox.hidden = false;
      } else sourceBox.hidden = true;

      recordRecent(data);
      empty.hidden = true;
      groups.hidden = false;
      // Mục "File tiêu chuẩn": tải bất đồng bộ, lỗi elib không ảnh
      // hưởng phần metadata (mục tự ẩn khi elib tắt/lỗi/cũ). Trang
      // tóm tắt cũng tải mục này bình thường (chỉ cần mã chuẩn).
      void loadStandardFiles(model.header.code, model);
      // Form nhập/sửa metadata (chỉ admin): hiện cả trên trang chi
      // tiết thật lẫn trang tóm tắt (trường hợp chính: tiêu chuẩn
      // chỉ có ở tìm kiếm, chưa có chi tiết từ nguồn).
      renderManualSection(model.header.code, data, isSummary);
    }

    function openPreview(data, model) {
      const body = $('#preview-body');
      body.replaceChildren();
      const title = document.createElement('h4');
      title.textContent = `${model.header.code || ''} — ${model.header.titleVi || model.header.titleEn || ''}`;
      body.append(title);
      const dl = document.createElement('dl');
      dl.className = 'detail-meta-rows';
      const rows = [
        [t('issuingAgency'), data.issuingAgency], [t('issuedDate'), data.issuedDate], [t('effectiveDate'), data.effectiveDate],
        [t('yearLabel'), data.year ?? model.header.year], [t('statusLabel'), data.status], [t('sourceLabel'), data.source]
      ];
      for (const [label, value] of rows) {
        const row = document.createElement('div');
        row.className = 'meta-row';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = dash(value);
        row.append(dt, dd);
        dl.append(row);
      }
      body.append(dl);
      if (model.scope.length > 0) {
        const scopeTitle = document.createElement('h4');
        scopeTitle.textContent = t('scope');
        body.append(scopeTitle);
        for (const item of model.scope) {
          const p = document.createElement('p');
          p.className = 'scope-text';
          p.textContent = dash(item.value);
          body.append(p);
        }
      }
      const link = $('#preview-source-link');
      const safe = safeWebUrl(data.detailUrl);
      // Same rule as the detail page: never link the TCVN front-api
      // JSON URL as a public source page.
      let isTcvnApiUrl = false;
      if (safe) {
        try { isTcvnApiUrl = new URL(safe).host === 'tracuu.tcvn.vn'; } catch { isTcvnApiUrl = false; }
      }
      link.hidden = !safe || isTcvnApiUrl;
      if (safe && !isTcvnApiUrl) link.href = safe;
      $('#preview-modal').hidden = false;
    }

    // ---- File tiêu chuẩn trên trang chi tiết (Phase B standard-pdf) ----
    // GET /api/elib/standards/:code/files qua proxy. elib tắt/lỗi/cũ
    // (chưa có route) -> ẩn hẳn mục, không hiện lỗi, trang metadata
    // vẫn dùng bình thường (cùng mẫu graceful như mục trang chủ).
    let standardFileCache = null; // { key, code, model, result }
    let standardFileSeq = 0;

    function standardFileCacheKey(code) {
      return `${code}::${elibUser?.id || 'anon'}`;
    }

    async function loadStandardFiles(code, model, options = {}) {
      const section = $('#detail-standard-file-section');
      if (!section) return;
      const cleanCode = String(code || '').trim();
      if (!cleanCode) { section.hidden = true; return; }
      const key = standardFileCacheKey(cleanCode);
      if (!options.force && standardFileCache?.key === key) {
        renderStandardFileSection(standardFileCache.result, model || standardFileCache.model);
        return;
      }
      // Tránh nháy file của tiêu chuẩn trước trong lúc chờ tải.
      section.hidden = true;
      const seq = ++standardFileSeq;
      const result = await elibFetchJson(standardFilesPath(cleanCode));
      if (seq !== standardFileSeq) return; // đã chuyển sang tiêu chuẩn khác
      standardFileCache = { key, code: cleanCode, model, result };
      renderStandardFileSection(result, model);
    }

    /** Đăng nhập/đăng xuất xong: quyền xem/tải lên đổi -> tải lại mục file. */
    function reloadStandardFiles() {
      if (!standardFileCache) return;
      if ($('#view-detail')?.hidden) return;
      const { code, model } = standardFileCache;
      standardFileCache = null;
      void loadStandardFiles(code, model, { force: true });
    }

    function renderStandardFileSection(result, model) {
      const section = $('#detail-standard-file-section');
      const body = $('#detail-standard-file-body');
      const note = $('#detail-nopdf-note');
      if (!section || !body) return;
      const state = standardFileState(result);
      const canUpload = canUploadStandardFile(elibUser);
      const doc = buildStandardFileDoc(result?.payload);
      const hasFile = state === 'file-view' || state === 'file-noaccess';
      // Đã có file thì câu "chưa có file PDF" không còn đúng nữa.
      if (note) note.hidden = hasFile;
      // Chưa có file mà cũng không có quyền tải lên (ẩn danh/external)
      // thì ẩn mục: elib trả document=null cả khi có file mà không
      // được thấy, hiện "chưa có file" sẽ gây hiểu nhầm.
      if (state === 'unavailable' || (state === 'no-file' && !canUpload)) {
        section.hidden = true;
        body.replaceChildren();
        return;
      }
      section.hidden = false;
      body.replaceChildren();
      if (hasFile && doc) {
        rememberDoc(doc);
        body.append(buildStandardCurrentFile(doc, state));
        body.append(buildStandardVersionHistory(doc, result.payload));
      } else {
        const none = document.createElement('p');
        none.className = 'standard-file-none';
        none.textContent = t('standardFileNone');
        body.append(none);
      }
      if (canUpload) body.append(buildStandardUploadBox(model));
    }

    function buildStandardCurrentFile(doc, state) {
      const wrap = document.createElement('div');
      wrap.className = 'standard-file-current';
      const file = doc.file || {};
      const info = document.createElement('div');
      info.className = 'standard-file-info';
      const name = document.createElement('span');
      name.className = 'standard-file-name';
      name.textContent = file.original_filename || doc.title || '';
      info.append(name);
      const metaParts = [];
      if (Number.isInteger(file.version)) {
        metaParts.push(t('standardVersion', { n: file.version }) + (file.version_label ? ` — ${file.version_label}` : ''));
      }
      if (file.file_size !== null && file.file_size !== undefined) metaParts.push(formatBytes(file.file_size));
      if (Number.isInteger(file.page_count)) metaParts.push(`${file.page_count} ${t('pagesUnit')}`);
      if (file.uploaded_at || file.created_at) {
        metaParts.push(t('standardUploadedAt', { date: formatDocDate(file.uploaded_at || file.created_at) }));
      }
      if (metaParts.length > 0) {
        const meta = document.createElement('span');
        meta.className = 'standard-file-meta';
        meta.textContent = metaParts.join(' · ');
        info.append(meta);
      }
      const warningKey = codeCheckWarningKey(file);
      if (warningKey) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-warning';
        badge.textContent = t(warningKey);
        info.append(badge);
      }
      wrap.append(info);

      const actions = document.createElement('div');
      actions.className = 'standard-file-actions';
      if (state === 'file-view') {
        const viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'button button-primary button-small';
        viewBtn.textContent = t('standardFileView');
        viewBtn.addEventListener('click', () => void openDocViewer(doc, 'full'));
        actions.append(viewBtn);
      } else {
        // Thấy tài liệu nhưng không được xem toàn bộ: chỉ xem trước
        // (nếu đã sẵn sàng), còn lại thông báo rõ.
        const aff = previewAffordance(doc);
        if (aff.showPreview) {
          const previewBtn = document.createElement('button');
          previewBtn.type = 'button';
          previewBtn.className = 'button button-primary button-small';
          previewBtn.textContent = t('viewPreview');
          previewBtn.addEventListener('click', () => void openDocViewer(doc, 'preview'));
          actions.append(previewBtn);
        } else {
          const noAccess = document.createElement('span');
          noAccess.className = 'standard-file-noaccess';
          noAccess.textContent = t('docNoAccess');
          actions.append(noAccess);
        }
      }
      // Tải bản gốc: chỉ chủ + admin (can_download từ elib); người
      // nội bộ không phải chủ chỉ xem, không có nút tải.
      if (doc.can_download === true && elibDownloadPath(doc)) {
        const downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'button button-secondary button-small';
        downloadBtn.textContent = t('elibDownload');
        downloadBtn.addEventListener('click', () => void downloadFile(doc));
        actions.append(downloadBtn);
      }
      if (actions.childElementCount > 0) wrap.append(actions);
      return wrap;
    }

    function buildStandardVersionHistory(doc, payload) {
      const versions = Array.isArray(payload?.versions) ? payload.versions : [];
      const wrap = document.createElement('div');
      wrap.className = 'standard-version-history';
      if (versions.length === 0) return wrap;
      const heading = document.createElement('h4');
      heading.className = 'standard-version-heading';
      heading.textContent = t('standardVersionHistory');
      wrap.append(heading);
      const list = document.createElement('ul');
      list.className = 'standard-version-list';
      const currentId = doc.current_file_id || doc.file?.id || null;
      for (const file of versions) {
        const row = document.createElement('li');
        row.className = 'standard-version-row';
        const isCurrent = file.id === currentId;
        const label = document.createElement('span');
        label.className = 'standard-version-label';
        label.textContent = t('standardVersion', { n: file.version ?? '?' }) + (file.version_label ? ` — ${file.version_label}` : '');
        row.append(label);
        const metaParts = [];
        if (file.original_filename) metaParts.push(file.original_filename);
        if (file.file_size !== null && file.file_size !== undefined) metaParts.push(formatBytes(file.file_size));
        if (file.uploaded_at || file.created_at) {
          metaParts.push(t('standardUploadedAt', { date: formatDocDate(file.uploaded_at || file.created_at) }));
        }
        if (metaParts.length > 0) {
          const meta = document.createElement('span');
          meta.className = 'standard-version-meta';
          meta.textContent = metaParts.join(' · ');
          row.append(meta);
        }
        const warningKey = codeCheckWarningKey(file);
        if (warningKey) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-warning';
          badge.textContent = t(warningKey);
          row.append(badge);
        }
        if (isCurrent) {
          const badge = document.createElement('span');
          badge.className = 'badge badge-source';
          badge.textContent = t('standardCurrentVersion');
          row.append(badge);
        } else if (isAdminUser(elibUser)) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'button button-secondary button-small';
          btn.textContent = t('standardSetCurrent');
          btn.addEventListener('click', () => void setStandardCurrentVersion(doc, file, btn));
          row.append(btn);
        }
        list.append(row);
      }
      wrap.append(list);
      return wrap;
    }

    async function setStandardCurrentVersion(doc, file, btn) {
      if (!confirm(t('standardSetCurrentConfirm'))) return;
      btn.disabled = true;
      const result = await elibFetchJson(`/documents/${encodeURIComponent(doc.id)}/current-version`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: file.id })
      });
      btn.disabled = false;
      if (result.status === 200 && result.payload?.document) {
        showToast(t('standardSetCurrentOk'));
        standardFileCache = null;
        if (currentDetail) {
          const model = buildDetailViewModel(currentDetail);
          void loadStandardFiles(model.header.code, model, { force: true });
        }
        return;
      }
      showToast(t('standardSetCurrentFailed'));
    }

    function buildStandardUploadBox(model) {
      const box = document.createElement('div');
      box.className = 'standard-upload-box';
      const title = document.createElement('h4');
      title.className = 'standard-upload-title';
      title.textContent = t('standardFileUpload');
      box.append(title);
      const hint = document.createElement('p');
      hint.className = 'standard-upload-hint';
      hint.textContent = t('standardFileUploadHint');
      box.append(hint);

      const fileField = document.createElement('label');
      fileField.className = 'field';
      const fileLabel = document.createElement('span');
      fileLabel.className = 'field-label';
      fileLabel.textContent = t('standardFileChoose');
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.pdf,application/pdf';
      fileInput.className = 'standard-upload-file';
      fileField.append(fileLabel, fileInput);
      box.append(fileField);

      const labelField = document.createElement('label');
      labelField.className = 'field';
      const labelText = document.createElement('span');
      labelText.className = 'field-label';
      labelText.textContent = t('standardVersionLabel');
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.maxLength = 100;
      labelInput.placeholder = t('standardVersionLabelPlaceholder');
      labelInput.className = 'standard-upload-label';
      labelField.append(labelText, labelInput);
      box.append(labelField);

      const progress = document.createElement('div');
      progress.className = 'elib-progress';
      progress.hidden = true;
      const track = document.createElement('div');
      track.className = 'elib-progress-track';
      const bar = document.createElement('div');
      bar.className = 'elib-progress-bar';
      track.append(bar);
      const progressText = document.createElement('span');
      progressText.textContent = '0%';
      progress.append(track, progressText);
      box.append(progress);

      const errorBox = document.createElement('div');
      errorBox.className = 'error-banner standard-upload-error';
      errorBox.hidden = true;
      box.append(errorBox);

      const duplicateBox = document.createElement('div');
      duplicateBox.className = 'elib-duplicate';
      duplicateBox.hidden = true;
      const duplicateText = document.createElement('p');
      duplicateBox.append(duplicateText);
      const duplicateActions = document.createElement('div');
      duplicateActions.className = 'elib-duplicate-actions';
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'button button-secondary button-small';
      skipBtn.textContent = t('elibSkip');
      const forceBtn = document.createElement('button');
      forceBtn.type = 'button';
      forceBtn.className = 'button button-terracotta button-small';
      forceBtn.textContent = t('elibForce');
      duplicateActions.append(skipBtn, forceBtn);
      duplicateBox.append(duplicateActions);
      box.append(duplicateBox);

      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'button button-terracotta';
      submit.textContent = t('elibUpload');
      box.append(submit);

      const els = { fileInput, labelInput, progress, bar, progressText, errorBox, duplicateBox, duplicateText, submit };
      skipBtn.addEventListener('click', () => { duplicateBox.hidden = true; });
      forceBtn.addEventListener('click', () => sendStandardUpload(model, els, true));
      submit.addEventListener('click', () => sendStandardUpload(model, els, false));
      return box;
    }

    function sendStandardUpload(model, els, force) {
      const { fileInput, labelInput, progress, bar, progressText, errorBox, duplicateBox, duplicateText, submit } = els;
      errorBox.hidden = true;
      if (!force) duplicateBox.hidden = true;
      const file = fileInput.files?.[0];
      if (!file) {
        errorBox.hidden = false;
        errorBox.textContent = t('standardNeedFile');
        return;
      }
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        errorBox.hidden = false;
        errorBox.textContent = t('standardFileMustPdf');
        return;
      }
      const code = model?.header?.code || '';
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', (model?.header?.titleVi || model?.header?.titleEn || code).slice(0, 300));
      formData.append('standard_code', code);
      if (model?.header?.titleVi) formData.append('standard_title_vi', model.header.titleVi);
      if (model?.header?.titleEn) formData.append('standard_title_en', model.header.titleEn);
      const yearMatch = /\b(19|20)\d{2}\b/.exec(String(model?.header?.year || ''));
      if (yearMatch) formData.append('standard_year', yearMatch[0]);
      const versionLabel = labelInput.value.trim();
      if (versionLabel) formData.append('version_label', versionLabel);
      // File tiêu chuẩn đã mua: xuất bản ngay để người nội bộ thấy được
      // (visibility bị elib ép 'internal', giá luôn NULL phía máy chủ).
      formData.append('status', 'published');
      if (force) formData.append('force', 'true');

      progress.hidden = false;
      bar.style.width = '0%';
      progressText.textContent = '0%';
      submit.disabled = true;
      submit.classList.add('is-loading');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', elibUrl('/documents'));
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', event => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        bar.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
      });
      xhr.addEventListener('load', () => {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        progress.hidden = true;
        let payload;
        try { payload = JSON.parse(xhr.responseText); } catch { payload = undefined; }
        if (xhr.status === 201 && payload?.document) {
          duplicateBox.hidden = true;
          showToast(t('standardUploadOk'));
          standardFileCache = null;
          void loadStandardFiles(code, model, { force: true });
          return;
        }
        const code2 = payload?.error?.code || '';
        const message = payload?.error?.message || `HTTP ${xhr.status}`;
        if (xhr.status === 409 && code2 === 'DUPLICATE_FILE') {
          duplicateBox.hidden = false;
          duplicateText.textContent = message || t('elibDuplicateFallback');
          return;
        }
        const key = standardUploadErrorKey(xhr.status, code2 || null);
        errorBox.hidden = false;
        errorBox.textContent = key === 'standardUploadFailed' && payload?.error?.message ? message : t(key);
        if (xhr.status === 401) void refreshElibAuth();
      });
      xhr.addEventListener('error', () => {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        progress.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = t('networkError');
      });
      xhr.send(formData);
    }

    // ---- Nhập/sửa metadata thủ công (chỉ admin, elib /admin/standards) ----
    // GET /api/elib/admin/standards/:code đọc bản ghi đã lưu (404 =
    // chưa có), PUT cùng đường dẫn ghi metadata nhập tay. Form hiện
    // trên cả trang chi tiết thật lẫn trang tóm tắt; trang tóm tắt
    // là trường hợp chính (tiêu chuẩn chỉ có ở tìm kiếm).
    let manualContext = null; // { code, data, isSummary }
    let manualSeq = 0;

    function hideManualSection() {
      const section = $('#detail-manual-section');
      const body = $('#detail-manual-body');
      manualContext = null;
      manualSeq += 1;
      if (section) section.hidden = true;
      if (body) body.replaceChildren();
    }

    function renderManualSection(code, data, isSummary) {
      const section = $('#detail-manual-section');
      const body = $('#detail-manual-body');
      if (!section || !body) return;
      const cleanCode = String(code || '').trim();
      manualContext = cleanCode ? { code: cleanCode, data, isSummary: Boolean(isSummary) } : null;
      if (!cleanCode || !canEditStandardMetadata(elibUser)) {
        section.hidden = true;
        body.replaceChildren();
        return;
      }
      section.hidden = false;
      const seq = ++manualSeq;
      const els = buildManualForm(cleanCode, data, isSummary);
      body.replaceChildren(els.box);
      // Trang tóm tắt: tra thêm bản ghi manual đã lưu để điền sẵn
      // (404 -> giữ giá trị tóm tắt/trống). Trang chi tiết thật:
      // điền sẵn từ chi tiết, không gọi GET.
      if (isSummary) void loadStoredManual(cleanCode, data, els, seq);
    }

    /** Đăng nhập/đăng xuất xong: quyền admin đổi -> dựng lại form. */
    function reloadManualSection() {
      if (!manualContext) return;
      if ($('#view-detail')?.hidden) return;
      const { code, data, isSummary } = manualContext;
      renderManualSection(code, data, isSummary);
    }

    function buildManualForm(code, data, isSummary) {
      const prefill = buildManualPrefill(data, isSummary ? pendingSummary : null, null);
      const box = document.createElement('div');
      box.className = 'manual-edit-box';
      const hint = document.createElement('p');
      hint.className = 'manual-edit-hint';
      hint.textContent = t('manualHint');
      box.append(hint);

      const fields = [
        { key: 'title_vi', labelKey: 'manualTitleVi', type: 'text' },
        { key: 'title_en', labelKey: 'manualTitleEn', type: 'text' },
        { key: 'status', labelKey: 'manualStatus', type: 'text' },
        { key: 'issued_date', labelKey: 'manualIssuedDate', type: 'date' },
        { key: 'effective_date', labelKey: 'manualEffectiveDate', type: 'date' },
        { key: 'replaces', labelKey: 'manualReplaces', type: 'text' },
        { key: 'replaced_by', labelKey: 'manualReplacedBy', type: 'text' },
        { key: 'ics', labelKey: 'manualIcs', type: 'text', hintKey: 'manualIcsHint' }
      ];
      const grid = document.createElement('div');
      grid.className = 'manual-edit-grid';
      const inputs = {};
      for (const field of fields) {
        const wrap = document.createElement('label');
        wrap.className = 'field';
        const label = document.createElement('span');
        label.className = 'field-label';
        label.textContent = t(field.labelKey);
        const input = document.createElement('input');
        input.type = field.type;
        input.className = `manual-input manual-input-${field.key}`;
        input.value = prefill[field.key] || '';
        if (field.hintKey) input.placeholder = t(field.hintKey);
        inputs[field.key] = input;
        wrap.append(label, input);
        grid.append(wrap);
      }
      box.append(grid);

      const errorBox = document.createElement('div');
      errorBox.className = 'error-banner manual-edit-error';
      errorBox.hidden = true;
      box.append(errorBox);

      const submit = document.createElement('button');
      submit.type = 'button';
      submit.className = 'button button-terracotta';
      submit.textContent = t('manualSave');
      box.append(submit);

      const els = { box, inputs, errorBox, submit };
      submit.addEventListener('click', () => void saveManual(code, els));
      return els;
    }

    function applyManualPrefill(els, prefill) {
      for (const [key, input] of Object.entries(els.inputs)) {
        input.value = prefill[key] || '';
      }
    }

    async function loadStoredManual(code, data, els, seq) {
      const result = await elibFetchJson(adminStandardPath(code));
      if (seq !== manualSeq) return; // đã chuyển sang tiêu chuẩn khác
      if (result.status === 200 && result.payload && typeof result.payload === 'object') {
        applyManualPrefill(els, buildManualPrefill(data, pendingSummary, result.payload));
        return;
      }
      // 404 = chưa có bản ghi manual (hoặc elib cũ chưa có route):
      // giữ giá trị tóm tắt/trống, không hiện lỗi.
      if (result.status === 404) return;
      els.errorBox.hidden = false;
      els.errorBox.textContent = result.errorMessage || t(manualSaveErrorKey(result.status ?? 0, result.errorCode || null));
      if (result.status === 401) void refreshElibAuth();
    }

    async function saveManual(code, els) {
      const values = {};
      for (const [key, input] of Object.entries(els.inputs)) values[key] = input.value;
      const payload = buildManualSavePayload(values);
      els.errorBox.hidden = true;
      els.submit.disabled = true;
      els.submit.classList.add('is-loading');
      const result = await elibFetchJson(adminStandardPath(code), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      els.submit.disabled = false;
      els.submit.classList.remove('is-loading');
      if (result.status === 200 || result.status === 201) {
        showToast(t('manualSaved'));
        // Làm mới trang chi tiết (pendingSummary cùng mã được giữ,
        // nên trang tóm tắt vẫn mở nếu nguồn vẫn chưa có chi tiết).
        void requestDetail(code, detailSourceSelect.value);
        return;
      }
      // Hiện lỗi elib đọc được, không bao giờ để trống: ưu tiên
      // message của elib, thiếu thì dùng khóa i18n theo mã ổn định.
      els.errorBox.hidden = false;
      els.errorBox.textContent = result.errorMessage
        || t(manualSaveErrorKey(result.status ?? 0, result.errorCode || null));
      if (result.status === 401) void refreshElibAuth();
    }

    async function requestDetail(codeOverride, sourceOverride, summaryOverride) {
      const code = String(codeOverride ?? detailInput.value).trim().replace(/\s+/g, ' ');
      if (!code) { showToast(t('enterCode')); detailInput.focus(); return; }
      detailInput.value = code;
      // Tóm tắt chỉ gắn với đúng mã của kết quả tìm kiếm vừa bấm:
      // đổi mã (gõ tay/liên kết trực tiếp) thì bỏ tóm tắt cũ; tải
      // lại cùng mã (lưu metadata, đổi ngôn ngữ) thì giữ tóm tắt.
      if (summaryOverride && summaryMatchesCode(summaryOverride, code)) {
        pendingSummary = summaryOverride;
      } else if (pendingSummary && !summaryMatchesCode(pendingSummary, code)) {
        pendingSummary = null;
      }
      const source = sourceOverride !== undefined ? sourceOverride : detailSourceSelect.value;
      if (source) detailSourceSelect.value = source;
      const url = new URL(location.href);
      url.searchParams.set('view', 'detail');
      url.searchParams.set('code', code);
      if (source) url.searchParams.set('source', source); else url.searchParams.delete('source');
      url.searchParams.delete('q');
      url.searchParams.delete('page');
      history.replaceState(null, '', url);
      $('#detail-empty').hidden = true;
      $('#detail-groups').hidden = true;
      $('#detail-skeleton').hidden = false;
      const params = source ? `?${new URLSearchParams({ source })}` : '';
      const result = await fetchApi(`/api/v1/standards/${encodeURIComponent(code)}${params}`);
      memory.detail = result;
      updateInspector('detail', result);
      renderRaw('detail', result.raw);
      renderDetailResult(result);
    }

    function openDetail(code, source, summary) {
      if (!code) return;
      showView('detail', false);
      void requestDetail(code, source || '', summary);
    }

    // ---- My Library ----
    function renderLibrary() {
      const renderInto = (containerId, emptyId, items, removable) => {
        const container = $(containerId);
        container.replaceChildren();
        $(emptyId).hidden = items.length !== 0;
        for (const item of items) {
          const row = document.createElement('div');
          row.className = 'library-row';
          const orgBadge = document.createElement('span');
          orgBadge.className = `lib-org-badge tone-${orgTone(item.code)}`;
          orgBadge.textContent = orgOf(item.code);
          const main = document.createElement('div');
          main.className = 'lib-main';
          const strong = document.createElement('strong');
          strong.textContent = dash(item.code);
          const small = document.createElement('small');
          small.textContent = [item.name, item.englishName, item.year ? String(item.year) : '', item.source].filter(Boolean).join(' · ');
          main.append(strong, small);
          const openBtn = document.createElement('button');
          openBtn.type = 'button';
          openBtn.className = 'detail-btn';
          openBtn.textContent = t('open');
          openBtn.addEventListener('click', () => openDetail(item.code, item.source, item));
          row.append(orgBadge, main, openBtn);
          if (removable) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'remove-btn';
            removeBtn.textContent = t('remove');
            removeBtn.addEventListener('click', () => { toggleFavorite(item); renderLibrary(); });
            row.append(removeBtn);
          }
          container.append(row);
        }
      };
      const favorites = getFavorites();
      const recent = getRecent();
      const favCount = $('#library-favorites-count');
      const recentCount = $('#library-recent-count');
      if (favCount) favCount.textContent = String(favorites.length);
      if (recentCount) recentCount.textContent = String(recent.length);
      renderInto('#library-favorites', '#library-favorites-empty', favorites, true);
      renderInto('#library-recent', '#library-recent-empty', recent, false);
    }

    // ---- Language ----
    function applyLanguage(lang) {
      currentLang = lang === 'en' ? 'en' : 'vi';
      document.documentElement.lang = currentLang;
      try { localStorage.setItem('smartrail-lang', currentLang); } catch { /* ignore */ }
      $('#lang-vi').classList.toggle('is-active', currentLang === 'vi');
      $('#lang-en').classList.toggle('is-active', currentLang === 'en');
      $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
      $$('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
      if (lastSearchPayload) applyFiltersAndRender();
      renderHeaderAuth();
      renderCategories();
      updateDropzoneDisplay();
      void loadHomeRecent();
      if (currentDetail && memory.detail) renderDetailResult(memory.detail);
      if (!$('#view-library').hidden) renderLibrary();
      if (!$('#view-documents').hidden) { renderElibUserBar(); renderElibSession(); }
      if (!$('#view-admin-users').hidden) void loadAdminUsersView();
      if (!$('#view-admin-tocs').hidden) {
        if ($('#admin-tocs-detail-panel') && !$('#admin-tocs-detail-panel').hidden && adminTocDetail) {
          renderAdminTocDetail(true);
        } else {
          renderAdminTocList();
        }
      }
      $('#doc-viewer-toc-close')?.setAttribute('aria-label', t('tocClose'));
      if (!$('#doc-viewer').hidden && viewerTocState) {
        if (viewerTocState.kind === 'ready' && viewerTocState.tree[0]?.virtual) {
          viewerTocState.tree[0].title = t('tocFirstPage');
        }
        renderViewerToc();
      }
    }

    // ---- Tài liệu (elib via /api/elib/* proxy) ----
    let elibUser = null;
    let elibCategoriesLoaded = false;
    const elibSessionUploads = [];
    let elibPendingUpload = null;

    function elibUrl(path) {
      return `/api/elib${path}`;
    }

    async function elibFetchJson(path, options = {}) {
      const url = elibUrl(path);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { credentials: 'same-origin', signal: controller.signal, ...options });
        const raw = await response.text();
        let payload;
        try { payload = JSON.parse(raw); } catch { payload = undefined; }
        const errorMessage = !response.ok ? (payload?.error?.message || `HTTP ${response.status}`) : '';
        return { status: response.status, payload, errorMessage, errorCode: payload?.error?.code || '' };
      } catch (error) {
        return { status: null, payload: undefined, errorMessage: error instanceof TypeError || error?.name === 'AbortError' ? t('networkError') : error.message, errorCode: '' };
      } finally {
        clearTimeout(timer);
      }
    }

    function setElibBanner(message) {
      const banner = $('#elib-banner');
      banner.hidden = !message;
      banner.textContent = message || '';
    }

    function renderElibUserBar() {
      const bar = $('#elib-user-bar');
      if (!elibUser) { bar.hidden = true; return; }
      bar.hidden = false;
      $('#elib-user-text').textContent = t('elibSignedInAs', { email: elibUser.email || '', role: elibUser.role || '' });
    }

    // Single source of truth for elib auth, shared by the header menu and
    // the Tài liệu view: 'ok' | 'anon' | 'disabled' | 'down'.
    let elibAuthStatus = 'anon';

    function renderHeaderAuth() {
      const loginBtn = $('#header-login-btn');
      const logoutBtn = $('#header-logout-btn');
      const uploadBtn = $('#header-upload-btn');
      const userInfo = $('#header-user-info');
      if (!loginBtn) return;
      const loggedIn = elibAuthStatus === 'ok' && Boolean(elibUser);
      loginBtn.hidden = loggedIn;
      logoutBtn.hidden = !loggedIn;
      userInfo.hidden = !loggedIn;
      if (loggedIn) userInfo.textContent = t('headerSignedInAs', { email: elibUser.email || '', role: elibUser.role || '' });
      uploadBtn.hidden = !(loggedIn && (elibUser.role === 'editor' || elibUser.role === 'admin'));
      const adminNav = $('#nav-admin-users');
      if (adminNav) adminNav.hidden = !(loggedIn && isAdminUser(elibUser));
      const adminTocNav = $('#nav-admin-tocs');
      if (adminTocNav) adminTocNav.hidden = !(loggedIn && canManageAdminTocs(elibUser));
      const loginNote = $('#header-login-note');
      if (loginNote) loginNote.hidden = loggedIn;
      // When elib is down/disabled, keep Đăng nhập visible (it opens the
      // Tài liệu view, which explains the state) and hide Tải lên.
      loginBtn.disabled = false;
    }

    async function refreshElibAuth() {
      const result = await elibFetchJson('/auth/me');
      if (result.status === 200 && result.payload?.user) {
        elibUser = result.payload.user;
        elibAuthStatus = 'ok';
      } else if (result.status === 401) {
        elibUser = null;
        elibAuthStatus = 'anon';
      } else if (result.status === 503 || result.errorCode === 'ELIB_DISABLED') {
        elibUser = null;
        elibAuthStatus = 'disabled';
      } else {
        elibUser = null;
        elibAuthStatus = 'down';
      }
      renderHeaderAuth();
      renderElibUserBar();
      // Admin: badge số tài khoản đang chờ duyệt trên menu.
      if (elibAuthStatus === 'ok' && isAdminUser(elibUser)) void refreshPendingBadge();
      else setPendingBadge(0);
      // Thẻ file render trước khi auth/me xong sẽ thiếu ô chọn visibility
      // (cần biết admin/chủ): tải lại mục trang chủ một lần khi đã biết user.
      if (homeRecentLoaded && !$('#view-home').hidden) void loadHomeRecent();
      reloadFileResultsIfLoaded();
      // Mục file tiêu chuẩn trên trang chi tiết cũng phụ thuộc quyền
      // (xem toàn bộ / tải lên): tải lại khi trạng thái đăng nhập đổi.
      reloadStandardFiles();
      // Form nhập metadata chỉ hiện với admin: dựng lại khi quyền đổi.
      reloadManualSection();
      if (!$('#view-admin-tocs').hidden) void loadAdminTocsView();
      return { status: elibAuthStatus, result };
    }

    function formatBytes(bytes) {
      return formatFileSize(bytes);
    }

    function renderElibSession() {
      const list = $('#elib-session-list');
      list.replaceChildren();
      $('#elib-session-empty').hidden = elibSessionUploads.length !== 0;
      for (const item of elibSessionUploads) {
        const row = document.createElement('div');
        row.className = 'elib-session-row';
        const kind = fileKindFromName(item.originalFilename, item.mimeType);
        const main = document.createElement('div');
        main.className = 'lib-main';
        const strong = document.createElement('strong');
        strong.textContent = dash(item.title);
        const small = document.createElement('small');
        small.textContent = [item.originalFilename, formatBytes(item.fileSize), item.mimeType].filter(Boolean).join(' · ');
        main.append(strong, small);
        row.append(fileBadge(kind), main);
        if (item.documentId && item.fileId) {
          const href = elibUrl(`/documents/${encodeURIComponent(item.documentId)}/files/${encodeURIComponent(item.fileId)}/download`);
          const link = document.createElement('a');
          link.className = 'button button-secondary button-small';
          link.href = href;
          link.textContent = t('elibDownload');
          row.append(link);
        }
        list.append(row);
      }
    }

    function flattenElibCategories(nodes, depth = 0, out = []) {
      for (const node of nodes || []) {
        out.push({ id: node.id, name: node.name, depth });
        flattenElibCategories(node.children, depth + 1, out);
      }
      return out;
    }

    async function loadElibCategories() {
      if (elibCategoriesLoaded) return;
      const result = await elibFetchJson('/categories');
      const select = $('#elib-category');
      if (result.status !== 200 || !result.payload) {
        showToast(t('elibCategoriesFailed'));
        return;
      }
      elibCategoriesLoaded = true;
      const flat = Array.isArray(result.payload.data) && result.payload.data.length > 0
        ? flattenElibCategories(result.payload.data)
        : (result.payload.flat || []).map(row => ({ id: row.id, name: row.name, depth: 0 }));
      for (const item of flat) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${'\u00A0\u00A0'.repeat(item.depth)}${item.name}`;
        select.append(option);
      }
    }

    async function loadDocumentsView() {
      setElibBanner('');
      $('#elib-loading').hidden = false;
      $('#elib-login-box').hidden = true;
      $('#elib-register-box').hidden = true;
      $('#elib-change-password-box').hidden = true;
      $('#elib-user-bar').hidden = true;
      $('#elib-no-permission').hidden = true;
      $('#elib-upload-form').hidden = true;
      renderElibSession();
      const { status, result } = await refreshElibAuth();
      $('#elib-loading').hidden = true;
      if (status === 'ok' && elibUser) {
        renderElibUserBar();
        // Mật khẩu tạm: chỉ hiện màn đổi mật khẩu (server cũng chặn
        // mọi API khác cho tới khi đổi xong).
        if (elibUser.mustChangePassword) {
          $('#elib-change-password-box').hidden = false;
          return;
        }
        if (elibUser.role === 'admin' || elibUser.role === 'editor') {
          $('#elib-upload-form').hidden = false;
          void loadElibCategories();
        } else {
          $('#elib-no-permission').hidden = false;
        }
        return;
      }
      if (status === 'anon') {
        $('#elib-login-box').hidden = false;
        return;
      }
      if (status === 'disabled') {
        setElibBanner(t('elibDisabled'));
        return;
      }
      setElibBanner(result.errorMessage || t('elibDown'));
    }

    function updateDropzoneDisplay() {
      const dropzone = $('#elib-dropzone');
      const input = $('#elib-file');
      const promptEl = $('#elib-dropzone-text');
      const selectedEl = $('#elib-file-selected');
      if (!dropzone || !input || !selectedEl) return;
      const file = input.files?.[0];
      if (!file) {
        dropzone.classList.remove('has-file');
        selectedEl.hidden = true;
        selectedEl.replaceChildren();
        if (promptEl) promptEl.textContent = t('elibDropHint');
        return;
      }
      dropzone.classList.add('has-file');
      if (promptEl) promptEl.textContent = t('elibDropChange');
      selectedEl.hidden = false;
      selectedEl.replaceChildren();
      const kind = fileKindFromName(file.name, file.type);
      const nameSpan = document.createElement('span');
      nameSpan.className = 'elib-selected-name';
      nameSpan.textContent = file.name;
      const sizeSpan = document.createElement('span');
      sizeSpan.className = 'elib-selected-size';
      sizeSpan.textContent = formatBytes(file.size);
      selectedEl.append(fileBadge(kind), nameSpan, sizeSpan);
      const titleInput = $('#elib-title');
      if (titleInput && !titleInput.value.trim()) {
        const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        if (baseName) titleInput.value = baseName;
      }
    }

    function buildElibFormData(force) {
      const formData = new FormData();
      const file = $('#elib-file').files?.[0];
      if (file) formData.append('file', file);
      formData.append('title', $('#elib-title').value.trim());
      formData.append('description', $('#elib-description').value.trim());
      const categoryId = $('#elib-category').value;
      if (categoryId) formData.append('category_id', categoryId);
      formData.append('doc_type', $('#elib-doc-type').value.trim());
      formData.append('language', $('#elib-language').value.trim());
      formData.append('tags', $('#elib-tags').value.trim());
      formData.append('visibility', $('#elib-visibility').value);
      formData.append('status', $('#elib-status').value);
      if (force) formData.append('force', 'true');
      return formData;
    }

    function sendElibUpload(force) {
      const errorBox = $('#elib-upload-error');
      const duplicateBox = $('#elib-duplicate');
      const successBox = $('#elib-success');
      const progress = $('#elib-progress');
      const bar = $('#elib-progress-bar');
      const progressText = $('#elib-progress-text');
      const submit = $('#elib-upload-submit');
      errorBox.hidden = true;
      successBox.hidden = true;
      if (!force) duplicateBox.hidden = true;
      progress.hidden = false;
      bar.style.width = '0%';
      progressText.textContent = '0%';
      submit.disabled = true;
      submit.classList.add('is-loading');

      const url = elibUrl('/documents');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', event => {
        if (!event.lengthComputable) return;
        const percent = Math.round((event.loaded / event.total) * 100);
        bar.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
      });
      xhr.addEventListener('load', () => {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        progress.hidden = true;
        let payload;
        try { payload = JSON.parse(xhr.responseText); } catch { payload = undefined; }
        if (xhr.status === 201 && payload?.document) {
          duplicateBox.hidden = true;
          elibPendingUpload = null;
          const doc = payload.document;
          const file = payload.file || {};
          elibSessionUploads.unshift({
            documentId: doc.id,
            fileId: file.id,
            title: doc.title || $('#elib-title').value.trim(),
            originalFilename: file.original_filename || '',
            fileSize: file.file_size,
            mimeType: file.mime_type || ''
          });
          renderElibSession();
          successBox.hidden = false;
          successBox.textContent = t('elibUploadOk', { title: doc.title || '' });
          showToast(t('elibUploadOk', { title: doc.title || '' }));
          $('#elib-upload-form').reset();
          updateDropzoneDisplay();
          return;
        }
        const code = payload?.error?.code || '';
        const message = payload?.error?.message || `HTTP ${xhr.status}`;
        if (xhr.status === 409 && code === 'DUPLICATE_FILE') {
          duplicateBox.hidden = false;
          $('#elib-duplicate-text').textContent = message || t('elibDuplicateFallback');
          return;
        }
        errorBox.hidden = false;
        errorBox.textContent = message;
        if (xhr.status === 401) void loadDocumentsView();
      });
      xhr.addEventListener('error', () => {
        submit.disabled = false;
        submit.classList.remove('is-loading');
        progress.hidden = true;
        errorBox.hidden = false;
        errorBox.textContent = t('networkError');
      });
      xhr.send(buildElibFormData(force));
    }

    // ---- Search tabs: standards | files ----
    let activeSearchTab = 'standards';

    function showSearchTab(tab) {
      activeSearchTab = tab === 'files' ? 'files' : 'standards';
      $('#search-tab-standards').hidden = activeSearchTab !== 'standards';
      $('#search-tab-files').hidden = activeSearchTab !== 'files';
      const stdBtn = $('#search-tab-btn-standards');
      const fileBtn = $('#search-tab-btn-files');
      stdBtn.classList.toggle('is-active', activeSearchTab === 'standards');
      fileBtn.classList.toggle('is-active', activeSearchTab === 'files');
      stdBtn.setAttribute('aria-selected', String(activeSearchTab === 'standards'));
      fileBtn.setAttribute('aria-selected', String(activeSearchTab === 'files'));
      if (activeSearchTab === 'files') void loadFileCategories();
    }

    function goFileSearch(query = '') {
      showView('search', false);
      showSearchTab('files');
      $('#file-search-query').value = query;
      void searchFiles(true);
    }

    // ---- File search (elib GET /api/elib/documents) ----
    const FILE_PAGE_SIZE = 20;
    const fileSearchState = { offset: 0, total: 0, loading: false, loaded: 0 };
    let fileCategoriesLoaded = false;

    async function loadFileCategories() {
      if (fileCategoriesLoaded) return;
      const select = $('#file-category-select');
      if (!select) return;
      const result = await elibFetchJson('/categories');
      if (result.status !== 200 || !result.payload) return;
      fileCategoriesLoaded = true;
      const flat = Array.isArray(result.payload.data) && result.payload.data.length > 0
        ? flattenElibCategories(result.payload.data)
        : (result.payload.flat || []).map(row => ({ id: row.id, name: row.name, depth: 0 }));
      for (const item of flat) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${'\u00A0\u00A0'.repeat(item.depth)}${item.name}`;
        select.append(option);
      }
    }

    function renderFileCard(doc) {
      const card = document.createElement('article');
      card.className = 'file-card';
      const kind = fileKindFromName(doc.file?.original_filename, doc.file?.mime_type);
      const body = document.createElement('div');
      body.className = 'file-card-body';
      const title = document.createElement('p');
      title.className = 'file-card-title';
      title.textContent = dash(doc.title);
      body.append(title);
      if (doc.file?.original_filename) {
        const name = document.createElement('p');
        name.className = 'file-card-name';
        name.textContent = doc.file.original_filename;
        body.append(name);
      }
      if (doc.description) {
        const desc = document.createElement('p');
        desc.className = 'file-card-desc';
        desc.textContent = doc.description;
        body.append(desc);
      }
      const chips = document.createElement('div');
      chips.className = 'meta-chips';
      if (doc.file) { const c = document.createElement('span'); c.className = 'chip'; c.textContent = formatBytes(doc.file.file_size); chips.append(c); }
      const dateChip = document.createElement('span');
      dateChip.className = 'chip';
      dateChip.textContent = `${t('uploadedOn')}: ${formatDocDate(doc.created_at)}`;
      chips.append(dateChip);
      if (doc.category?.name) { const c = document.createElement('span'); c.className = 'chip chip-source'; c.textContent = doc.category.name; chips.append(c); }
      body.append(chips);
      if (Array.isArray(doc.tags) && doc.tags.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'file-tags';
        for (const tag of doc.tags) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'tag-chip';
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            $('#file-search-query').value = tag;
            void searchFiles(true);
          });
          tags.append(chip);
        }
        body.append(tags);
      }
      const actions = document.createElement('div');
      actions.className = 'file-card-actions';
      appendPreviewAffordances(actions, doc);
      appendDownloadAffordance(actions, doc);
      appendVisibilityControl(actions, doc);
      card.append(fileBadge(kind), body, actions);
      makeCardOpenPreview(card, doc);
      return card;
    }

    /**
     * Quyền tải (can_download) phụ thuộc người dùng hiện tại: khi
     * đăng nhập/đăng xuất xong, tải lại danh sách file đã hiện để
     * nút tải/gợi ý liên hệ khớp quyền mới (như loadHomeRecent).
     */
    function reloadFileResultsIfLoaded() {
      if (fileSearchState.loaded > 0 && !fileSearchState.loading) void searchFiles(true);
    }

    async function searchFiles(reset) {
      if (fileSearchState.loading) return;
      const query = $('#file-search-query').value.trim();
      const categoryId = $('#file-category-select').value;
      if (reset) {
        fileSearchState.offset = 0;
        fileSearchState.loaded = 0;
        $('#file-results').replaceChildren();
      }
      fileSearchState.loading = true;
      $('#file-search-error').hidden = true;
      $('#file-search-skeleton').hidden = false;
      $('#file-load-more-wrap').hidden = true;
      const params = new URLSearchParams({ limit: String(FILE_PAGE_SIZE), offset: String(fileSearchState.offset) });
      if (query) params.set('q', query);
      if (categoryId) params.set('category_id', categoryId);
      const result = await elibFetchJson(`/documents?${params}`);
      fileSearchState.loading = false;
      $('#file-search-skeleton').hidden = true;
      const empty = $('#file-search-empty');
      const countEl = $('#file-result-count');
      if (result.status !== 200 || !result.payload || !Array.isArray(result.payload.data)) {
        const errorBox = $('#file-search-error');
        errorBox.hidden = false;
        errorBox.textContent = t('fileSearchError');
        countEl.textContent = '';
        empty.hidden = fileSearchState.loaded !== 0;
        if (fileSearchState.loaded === 0) {
          empty.querySelector('strong').textContent = t('fileSearchError');
          empty.querySelector('p').textContent = t('fileNoResultsHint');
        }
        return;
      }
      const data = result.payload.data;
      fileSearchState.total = Number.isInteger(result.payload.total) ? result.payload.total : data.length;
      fileSearchState.offset += data.length;
      fileSearchState.loaded += data.length;
      const container = $('#file-results');
      for (const doc of data) { rememberDoc(doc); container.append(renderFileCard(doc)); }
      countEl.textContent = t('fileResultsFound', { n: fileSearchState.total.toLocaleString() });
      empty.hidden = fileSearchState.loaded !== 0;
      if (fileSearchState.loaded === 0) {
        empty.querySelector('strong').textContent = t('fileNoResults');
        empty.querySelector('p').textContent = t('fileNoResultsHint');
      }
      $('#file-load-more-wrap').hidden = !(fileSearchState.loaded < fileSearchState.total);
    }

    // ---- Events ----
    $('#doc-viewer-close').addEventListener('click', closeDocViewer);
    // Tải qua fetch để 403 DOWNLOAD_FORBIDDEN hiện thông báo rõ thay vì lỗi trống.
    $('#doc-viewer-download').addEventListener('click', (event) => {
      event.preventDefault();
      if (viewerDoc) void downloadFile(viewerDoc);
    });
    $('#doc-viewer-end-login').addEventListener('click', () => { closeDocViewer(); showView('documents'); });
    window.addEventListener('hashchange', () => {
      const id = parseDocDeepLink(location.hash);
      if (id && viewerDocId !== id) void openDeepLinkedDoc(id);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#doc-viewer').hidden) closeDocViewer();
    });
    const scrollViewerPage = (delta) => {
      const canvases = viewerState?.canvases;
      if (!Array.isArray(canvases) || canvases.length === 0) return;
      const current = viewerState?.pinnedPage ?? computeCurrentViewerPage();
      const targetPage = Math.min(canvases.length, Math.max(1, current + delta));
      jumpToViewerPage(targetPage);
    };
    $('#doc-viewer-prev').addEventListener('click', () => scrollViewerPage(-1));
    $('#doc-viewer-next').addEventListener('click', () => scrollViewerPage(1));
    $('#doc-viewer-toc-toggle').addEventListener('click', () => {
      if (!viewerTocState) return;
      viewerTocOpen = !viewerTocOpen;
      applyTocVisibility();
    });
    const closeTocDrawer = () => {
      if (!viewerTocState) return;
      viewerTocOpen = false;
      applyTocVisibility();
    };
    $('#doc-viewer-toc-close').addEventListener('click', closeTocDrawer);
    $('#doc-viewer-toc-backdrop').addEventListener('click', closeTocDrawer);
    $('#doc-viewer-toc-search').addEventListener('input', (event) => {
      if (!viewerTocState || viewerTocState.kind !== 'ready') return;
      viewerTocState.query = event.target.value || '';
      renderViewerToc();
    });
    const viewerPagesEl = $('#doc-viewer-pages');
    viewerPagesEl.addEventListener('scroll', () => {
      if (!viewerState || viewerState.pinnedPage) return;
      if (viewerState.scrollRaf) return;
      viewerState.scrollRaf = requestAnimationFrame(() => {
        if (!viewerState) return;
        viewerState.scrollRaf = 0;
        const page = computeCurrentViewerPage();
        if (viewerState.currentPage !== page) {
          viewerState.currentPage = page;
          if (viewerState.mode !== 'preview' && viewerState.totalPages > 0) {
            $('#doc-viewer-pageinfo').textContent = t('viewerPage', { n: page, total: viewerState.totalPages });
          }
          updateActiveTocHighlight(page);
        }
      });
    }, { passive: true });
    const clearViewerPin = () => {
      if (!viewerState) return;
      viewerState.pinnedPage = null;
      clearTimeout(viewerState.pinTimer);
      viewerState.pinTimer = null;
    };
    viewerPagesEl.addEventListener('wheel', clearViewerPin, { passive: true });
    viewerPagesEl.addEventListener('touchstart', clearViewerPin, { passive: true });
    window.addEventListener('resize', () => {
      if (!$('#doc-viewer').hidden && viewerTocState) applyTocVisibility();
    });
    $$('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    $$('[data-goto-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.gotoView)));
    $('#mobile-menu').addEventListener('click', () => {
      const nav = $('#main-nav');
      const open = nav.classList.toggle('is-open');
      $('#mobile-menu').setAttribute('aria-expanded', String(open));
    });
    $('#lang-vi').addEventListener('click', () => applyLanguage('vi'));
    $('#lang-en').addEventListener('click', () => applyLanguage('en'));
    $('#to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('#hero-search-form').addEventListener('submit', event => {
      event.preventDefault();
      const query = $('#hero-query').value.trim();
      if (query.length < 2) { showToast(t('enterQuery')); return; }
      goSearch(query);
    });
    $$('[data-discipline-query]').forEach(button => button.addEventListener('click', () => goSearch(button.dataset.disciplineQuery)));
    $$('[data-collection-query]').forEach(button => button.addEventListener('click', () => goSearch(button.dataset.collectionQuery)));
    $$('[data-goto-search]').forEach(button => button.addEventListener('click', () => goSearch(button.dataset.gotoSearch)));
    searchForm.addEventListener('submit', event => { event.preventDefault(); void searchStandards(); });
    detailForm.addEventListener('submit', event => { event.preventDefault(); void requestDetail(); });
    $$('[data-query]').forEach(button => button.addEventListener('click', () => { searchInput.value = button.dataset.query; searchPage.value = '1'; void searchStandards(); }));
    $('#advanced-toggle').addEventListener('click', () => {
      const panel = $('#advanced-panel');
      panel.hidden = !panel.hidden;
      $('#advanced-toggle').setAttribute('aria-expanded', String(!panel.hidden));
    });
    $('#previous-page').addEventListener('click', () => { searchPage.value = String(Math.max(1, Number(searchPage.value) - 1)); void searchStandards(); });
    $('#next-page').addEventListener('click', () => { searchPage.value = String(Math.min(1000, Number(searchPage.value) + 1)); void searchStandards(); });
    $$('.filter-source').forEach(cb => cb.addEventListener('change', applyFiltersAndRender));
    $('#filter-year').addEventListener('input', applyFiltersAndRender);
    $('#filter-status').addEventListener('change', applyFiltersAndRender);
    $('#sort-select').addEventListener('change', applyFiltersAndRender);
    $('#filter-clear').addEventListener('click', () => {
      $$('.filter-source').forEach(cb => { cb.checked = true; });
      $('#filter-year').value = '';
      $('#filter-status').value = '';
      $('#adv-source').value = '';
      $('#adv-year').value = '';
      applyFiltersAndRender();
    });
    $('#view-toggle-list').addEventListener('click', () => { resultsViewMode = 'list'; $('#view-toggle-list').classList.add('is-active'); $('#view-toggle-grid').classList.remove('is-active'); applyFiltersAndRender(); });
    $('#view-toggle-grid').addEventListener('click', () => { resultsViewMode = 'grid'; $('#view-toggle-grid').classList.add('is-active'); $('#view-toggle-list').classList.remove('is-active'); applyFiltersAndRender(); });
    $('#search-raw-toggle').addEventListener('click', () => {
      const pane = $('#search-raw-pane');
      pane.hidden = !pane.hidden;
      $('#search-raw-toggle').setAttribute('aria-expanded', String(!pane.hidden));
    });
    $$('[data-response-tab]').forEach(button => button.addEventListener('click', () => {
      const group = button.closest('.detail-main');
      group.querySelectorAll('[data-response-tab]').forEach(tab => tab.classList.toggle('is-active', tab === button));
      group.querySelectorAll('.response-pane').forEach(pane => {
        const active = pane.id === `${button.dataset.responseTab}-pane`;
        pane.hidden = !active;
        pane.classList.toggle('is-active', active);
      });
    }));
    $$('[data-copy-url]').forEach(button => button.addEventListener('click', async () => {
      const url = $(`#${button.dataset.copyUrl}-request-url`).textContent;
      if (!url || url === DASH) return showToast(t('copyFailed'));
      try { await navigator.clipboard.writeText(url); showToast(t('copied')); } catch { showToast(t('copyFailed')); }
    }));
    $$('.copy-json').forEach(button => button.addEventListener('click', async () => {
      const result = memory[button.dataset.raw];
      if (!result) return showToast(t('copyFailed'));
      try { await navigator.clipboard.writeText(result.raw); showToast(t('copied')); } catch { showToast(t('copyFailed')); }
    }));
    $('#preview-close').addEventListener('click', () => { $('#preview-modal').hidden = true; });
    $('#preview-modal').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.hidden = true; });
    $('#library-clear-recent').addEventListener('click', () => { writeList('smartrail-recent', []); renderLibrary(); showToast(t('clearRecentDone')); });
    $('#header-login-btn').addEventListener('click', () => showView('documents'));
    $('#header-upload-btn').addEventListener('click', () => showView('documents'));
    $('#header-logout-btn').addEventListener('click', async () => {
      await elibFetchJson('/auth/logout', { method: 'POST' });
      elibUser = null;
      elibAuthStatus = 'anon';
      renderHeaderAuth();
      showToast(t('elibLoggedOut'));
      if (!$('#view-documents').hidden) void loadDocumentsView();
      if (!$('#view-admin-tocs').hidden) { destroyAdminTocPdf(); void loadAdminTocsView(); }
      void loadHomeRecent();
      reloadFileResultsIfLoaded();
    });
    $('#search-tab-btn-standards').addEventListener('click', () => showSearchTab('standards'));
    $('#search-tab-btn-files').addEventListener('click', () => { showSearchTab('files'); if (fileSearchState.loaded === 0 && !fileSearchState.loading) void searchFiles(true); });
    $('#file-search-form').addEventListener('submit', event => { event.preventDefault(); void searchFiles(true); });
    $('#file-category-select').addEventListener('change', () => void searchFiles(true));
    $('#file-load-more').addEventListener('click', () => void searchFiles(false));
    $$('[data-goto-file-search]').forEach(button => button.addEventListener('click', () => goFileSearch('')));
    $('#elib-login-form').addEventListener('submit', async event => {
      event.preventDefault();
      const errorBox = $('#elib-login-error');
      errorBox.hidden = true;
      const submit = $('#elib-login-submit');
      submit.disabled = true;
      const result = await elibFetchJson('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: $('#elib-email').value.trim(), password: $('#elib-password').value })
      });
      submit.disabled = false;
      if (result.status === 200) {
        $('#elib-password').value = '';
        // mustChangePassword: loadDocumentsView sẽ hiện màn đổi mật khẩu.
        void loadDocumentsView();
        void loadHomeRecent();
        return;
      }
      errorBox.hidden = false;
      errorBox.textContent = t(loginErrorKey(result.status ?? 0, result.errorCode || null));
    });
    $('#elib-logout-btn').addEventListener('click', async () => {
      await elibFetchJson('/auth/logout', { method: 'POST' });
      elibUser = null;
      elibAuthStatus = 'anon';
      renderHeaderAuth();
      showToast(t('elibLoggedOut'));
      void loadDocumentsView();
      if (!$('#view-admin-tocs').hidden) { destroyAdminTocPdf(); void loadAdminTocsView(); }
      void loadHomeRecent();
      reloadFileResultsIfLoaded();
    });
    $('#elib-upload-form').addEventListener('submit', event => {
      event.preventDefault();
      const file = $('#elib-file').files?.[0];
      const title = $('#elib-title').value.trim();
      if (!file || !title) { showToast(t('elibNeedFileTitle')); return; }
      elibPendingUpload = true;
      sendElibUpload(false);
    });
    $('#elib-duplicate-skip').addEventListener('click', () => {
      $('#elib-duplicate').hidden = true;
      elibPendingUpload = null;
    });
    $('#elib-duplicate-force').addEventListener('click', () => {
      if (!elibPendingUpload) return;
      sendElibUpload(true);
    });
    const elibFileInput = $('#elib-file');
    const elibDropzone = $('#elib-dropzone');
    if (elibFileInput) elibFileInput.addEventListener('change', updateDropzoneDisplay);
    if (elibDropzone) {
      elibDropzone.addEventListener('dragenter', event => {
        event.preventDefault();
        elibDropzone.classList.add('is-dragover');
      });
      elibDropzone.addEventListener('dragover', event => {
        event.preventDefault();
        elibDropzone.classList.add('is-dragover');
      });
      elibDropzone.addEventListener('dragleave', event => {
        if (!event.relatedTarget || !elibDropzone.contains(event.relatedTarget)) {
          elibDropzone.classList.remove('is-dragover');
        }
      });
      elibDropzone.addEventListener('drop', event => {
        event.preventDefault();
        elibDropzone.classList.remove('is-dragover');
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0 || !elibFileInput) return;
        try {
          const dt = new DataTransfer();
          dt.items.add(files[0]);
          elibFileInput.files = dt.files;
        } catch {
          // Fallback when DataTransfer assignment is unsupported
        }
        updateDropzoneDisplay();
      });
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        const modal = $('#preview-modal');
        if (modal && !modal.hidden) { modal.hidden = true; return; }
        const nav = $('#main-nav');
        if (nav && nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
        }
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const active = document.activeElement;
        const tag = active?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
        event.preventDefault();
        if (!$('#view-home').hidden) $('#hero-query')?.focus();
        else if (!$('#view-search').hidden) (activeSearchTab === 'files' ? $('#file-search-query') : $('#search-query'))?.focus();
        else if (!$('#view-detail').hidden) $('#detail-code-input')?.focus();
      }
    });

    // ---- Quản trị mục lục PDF (chỉ admin, P3) ----
    let adminTocListState = {
      offset: 0,
      limit: ADMIN_TOC_DEFAULT_LIMIT,
      total: 0,
      currentAlgorithmVersion: '',
      items: []
    };
    let adminTocListSeq = 0;
    let adminTocDetailSeq = 0;
    let adminTocDetail = null;
    let adminTocEditorNodes = [];
    let adminTocAutoCollapsedIds = new Set();
    let adminTocPdfSeq = 0;
    let adminTocPdfState = null; // { loadingTask, pdf, totalPages, currentPage, renderTask, pendingPage }

    function destroyAdminTocPdf() {
      adminTocPdfSeq += 1;
      if (adminTocPdfState?.renderTask?.cancel) {
        try { adminTocPdfState.renderTask.cancel(); } catch { /* ignore */ }
      }
      if (adminTocPdfState?.loadingTask) {
        adminTocPdfState.loadingTask.destroy().catch(() => undefined);
      }
      adminTocPdfState = null;
      const canvas = $('#admin-toc-pdf-canvas');
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      const statusEl = $('#admin-toc-pdf-status');
      if (statusEl) { statusEl.hidden = true; statusEl.textContent = ''; statusEl.classList.remove('viewer-error'); }
      const warnEl = $('#admin-toc-pdf-version-warn');
      if (warnEl) warnEl.hidden = true;
      const pageTotal = $('#admin-toc-pdf-page-total');
      if (pageTotal) pageTotal.textContent = '';
      const pageInput = $('#admin-toc-pdf-page-input');
      if (pageInput) pageInput.value = '1';
    }

    async function renderAdminTocPdfPage(pageNum) {
      const requested = Math.trunc(Number(pageNum));
      if (!Number.isFinite(requested) || requested < 1) return;
      if (!adminTocPdfState) return;
      if (!adminTocPdfState.pdf) {
        adminTocPdfState.pendingPage = requested;
        return;
      }
      const total = adminTocPdfState.totalPages || adminTocPdfState.pdf.numPages || 1;
      const clamped = Math.min(total, Math.max(1, requested));
      adminTocPdfState.currentPage = clamped;
      const pageInput = $('#admin-toc-pdf-page-input');
      if (pageInput) pageInput.value = String(clamped);
      const canvas = $('#admin-toc-pdf-canvas');
      if (!canvas) return;
      if (adminTocPdfState.renderTask?.cancel) {
        try { adminTocPdfState.renderTask.cancel(); } catch { /* ignore */ }
      }
      const currentSeq = adminTocPdfSeq;
      try {
        const page = await adminTocPdfState.pdf.getPage(clamped);
        if (currentSeq !== adminTocPdfSeq || !adminTocPdfState) return;
        const viewport = page.getViewport({ scale: 1.15 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
        adminTocPdfState.renderTask = renderTask;
        await renderTask.promise;
        if (adminTocPdfState?.renderTask === renderTask) adminTocPdfState.renderTask = null;
        if (requested > total) {
          showToast(t('adminTocErrPageRange', { index: 1, page: requested, totalPages: total }));
        }
      } catch (err) {
        if (err?.name === 'RenderingCancelledException') return;
      }
    }

    async function loadAdminTocPdf(detail) {
      destroyAdminTocPdf();
      const preview = adminTocPreviewPath(detail);
      const statusEl = $('#admin-toc-pdf-status');
      const warnEl = $('#admin-toc-pdf-version-warn');
      if (!preview || !statusEl) return;
      if (warnEl) warnEl.hidden = preview.isCurrentVersion;
      statusEl.hidden = false;
      statusEl.classList.remove('viewer-error');
      statusEl.textContent = t('adminTocPreviewLoading');

      const seq = ++adminTocPdfSeq;
      adminTocPdfState = { loadingTask: null, pdf: null, totalPages: 0, currentPage: 1, renderTask: null, pendingPage: 1 };

      try {
        const pdfjs = await loadPdfjs();
        if (seq !== adminTocPdfSeq || $('#view-admin-tocs').hidden) return;
        let loadingTask;
        const probe = await fetch(preview.url, { credentials: 'same-origin', headers: { Range: 'bytes=0-0' } });
        if (probe.ok || probe.status === 206) {
          loadingTask = pdfjs.getDocument({
            url: preview.url,
            isEvalSupported: false,
            standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
            withCredentials: true
          });
        } else {
          const fallbackBytes = await fetchDocBytes(preview.fallbackUrl);
          loadingTask = pdfjs.getDocument({
            data: fallbackBytes,
            isEvalSupported: false,
            standardFontDataUrl: '/vendor/pdfjs/standard_fonts/'
          });
        }
        if (seq !== adminTocPdfSeq || $('#view-admin-tocs').hidden || $('#admin-tocs-detail-panel').hidden) {
          loadingTask.destroy().catch(() => undefined);
          return;
        }
        adminTocPdfState.loadingTask = loadingTask;
        const pdf = await loadingTask.promise;
        if (seq !== adminTocPdfSeq || !adminTocPdfState) return;
        adminTocPdfState.pdf = pdf;
        adminTocPdfState.totalPages = pdf.numPages;
        const pageTotal = $('#admin-toc-pdf-page-total');
        if (pageTotal) pageTotal.textContent = t('adminTocPreviewPageOf', { total: pdf.numPages });
        const pageInput = $('#admin-toc-pdf-page-input');
        if (pageInput) pageInput.max = String(pdf.numPages);
        statusEl.hidden = true;
        const initialPage = adminTocPdfState.pendingPage || 1;
        adminTocPdfState.pendingPage = null;
        await renderAdminTocPdfPage(initialPage);
      } catch (err) {
        if (seq !== adminTocPdfSeq) return;
        if (adminTocPdfState?.loadingTask) {
          adminTocPdfState.loadingTask.destroy().catch(() => undefined);
        }
        adminTocPdfState = null;
        statusEl.hidden = false;
        statusEl.classList.add('viewer-error');
        statusEl.textContent = err?.status
          ? t(previewErrorKey(err.status, err.code || null))
          : t('adminTocPreviewError');
      }
    }

    function readAdminTocFilters() {
      return {
        auto_status: $('#admin-toc-filter-auto-status')?.value || '',
        job_status: $('#admin-toc-filter-job-status')?.value || '',
        flag: $('#admin-toc-filter-flag')?.value?.trim() || '',
        manual_override: $('#admin-toc-filter-manual')?.value || '',
        standards_only: $('#admin-toc-filter-standards')?.value || '',
        outdated_algorithm: Boolean($('#admin-toc-filter-outdated')?.checked)
      };
    }

    function adminTocBadge(text, toneClass) {
      const span = document.createElement('span');
      span.className = `badge ${toneClass}`;
      span.textContent = text;
      return span;
    }

    function adminTocAutoStatusLabel(status) {
      const map = {
        ok: 'adminTocStatusOk',
        partial: 'adminTocStatusPartial',
        needs_ocr: 'adminTocStatusNeedsOcr',
        failed: 'adminTocStatusFailed',
        unsupported: 'adminTocStatusUnsupported'
      };
      return map[status] ? t(map[status]) : dash(status);
    }

    function adminTocJobStatusLabel(status) {
      const map = {
        pending: 'adminTocJobPending',
        processing: 'adminTocJobProcessing',
        done: 'adminTocJobDone',
        failed: 'adminTocJobFailed',
        unsupported: 'adminTocJobUnsupported'
      };
      return map[status] ? t(map[status]) : dash(status);
    }

    function renderAdminTocList() {
      const listEl = $('#admin-tocs-list');
      const emptyEl = $('#admin-tocs-empty');
      const summaryEl = $('#admin-tocs-summary');
      const pagingEl = $('#admin-tocs-pagination');
      if (!listEl || !emptyEl || !summaryEl || !pagingEl) return;

      listEl.replaceChildren();
      const items = adminTocListState.items || [];
      const total = adminTocListState.total || 0;
      const offset = adminTocListState.offset || 0;
      const limit = adminTocListState.limit || ADMIN_TOC_DEFAULT_LIMIT;
      const from = total === 0 ? 0 : offset + 1;
      const to = Math.min(total, offset + items.length);
      summaryEl.textContent = t('adminTocListSummary', {
        from,
        to,
        total,
        ver: adminTocListState.currentAlgorithmVersion || DASH
      });

      emptyEl.hidden = items.length !== 0;
      pagingEl.hidden = total <= limit && offset === 0;
      $('#admin-tocs-prev').disabled = offset <= 0;
      $('#admin-tocs-next').disabled = offset + items.length >= total;
      $('#admin-tocs-page-info').textContent = `${from}–${to} / ${total}`;

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'admin-toc-row';
        const main = document.createElement('div');
        main.className = 'admin-toc-row-main';
        const titleEl = document.createElement('strong');
        titleEl.textContent = item.standard_code_display
          ? `${item.standard_code_display} — ${item.document_title || item.original_filename}`
          : (item.document_title || item.original_filename || item.file_id);
        const meta = document.createElement('span');
        meta.className = 'admin-toc-row-meta';
        const verLabel = item.version_label ? ` (${item.version_label})` : '';
        const metaParts = [
          t('standardVersion', { n: item.version ?? '?' }) + verLabel,
          item.original_filename || '',
          Number.isInteger(item.page_count) ? `${item.page_count} ${t('pagesUnit')}` : '',
          item.algorithm_version ? `algo: ${item.algorithm_version}` : ''
        ].filter(Boolean);
        meta.textContent = metaParts.join(' · ');

        const badges = document.createElement('div');
        badges.className = 'admin-toc-badges';
        if (item.is_current_version) {
          badges.append(adminTocBadge(t('standardCurrentVersion'), 'badge-source'));
        }
        const autoTone = item.auto_status === 'ok'
          ? 'badge-toc-ok'
          : item.auto_status === 'failed'
            ? 'badge-toc-err'
            : 'badge-toc-warn';
        badges.append(adminTocBadge(`auto: ${adminTocAutoStatusLabel(item.auto_status)}`, autoTone));
        const jobTone = item.job_status === 'done'
          ? 'badge-toc-ok'
          : item.job_status === 'failed'
            ? 'badge-toc-err'
            : 'badge-toc-warn';
        badges.append(adminTocBadge(`job: ${adminTocJobStatusLabel(item.job_status)}`, jobTone));
        if (item.manual_override === true) {
          badges.append(adminTocBadge(t('adminTocHasManual'), 'badge-toc-manual'));
        }
        if (
          adminTocListState.currentAlgorithmVersion &&
          item.algorithm_version !== adminTocListState.currentAlgorithmVersion
        ) {
          badges.append(adminTocBadge(t('adminTocOutdatedAlgo'), 'badge-toc-outdated'));
        }
        if (Array.isArray(item.auto_flags)) {
          for (const flag of item.auto_flags) {
            badges.append(adminTocBadge(String(flag), 'badge-neutral'));
          }
        }
        main.append(titleEl, meta, badges);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'button button-secondary button-small';
        openBtn.textContent = t('adminTocOpenDetail');
        openBtn.addEventListener('click', () => void loadAdminTocDetail(item.file_id));

        row.append(main, openBtn);
        listEl.append(row);
      }
    }

    async function loadAdminTocsList(options = {}) {
      const banner = $('#admin-tocs-banner');
      const listPanel = $('#admin-tocs-list-panel');
      const detailPanel = $('#admin-tocs-detail-panel');
      if (!banner || !listPanel || !detailPanel) return;
      banner.hidden = true;
      if (!options.keepView) {
        detailPanel.hidden = true;
        listPanel.hidden = false;
        destroyAdminTocPdf();
      }
      if (!canManageAdminTocs(elibUser)) {
        listPanel.hidden = true;
        detailPanel.hidden = true;
        banner.hidden = false;
        banner.textContent = t('adminErrForbidden');
        return;
      }

      const seq = ++adminTocListSeq;
      $('#admin-tocs-loading').hidden = false;
      const path = adminTocsListPath(readAdminTocFilters(), adminTocListState.limit, adminTocListState.offset);
      const result = await elibFetchJson(path);
      if (seq !== adminTocListSeq) return;
      $('#admin-tocs-loading').hidden = true;

      if (result.status !== 200 || !result.payload || !Array.isArray(result.payload.data)) {
        banner.hidden = false;
        banner.textContent = result.status === 401 || result.status === 403 || result.status === 400
          ? formatAdminTocError(result, t)
          : t('adminTocLoadFailed');
        return;
      }

      adminTocListState.items = result.payload.data;
      adminTocListState.total = Number(result.payload.total ?? result.payload.data.length);
      adminTocListState.limit = Number(result.payload.limit ?? adminTocListState.limit);
      adminTocListState.offset = Number(result.payload.offset ?? adminTocListState.offset);
      adminTocListState.currentAlgorithmVersion = result.payload.current_algorithm_version || '';
      renderAdminTocList();
    }

    function renderAdminTocEditorRows() {
      const container = $('#admin-toc-editor-rows');
      const emptyEl = $('#admin-toc-editor-empty');
      if (!container || !emptyEl) return;
      container.replaceChildren();
      emptyEl.hidden = adminTocEditorNodes.length !== 0;

      for (let i = 0; i < adminTocEditorNodes.length; i += 1) {
        const node = adminTocEditorNodes[i];
        const row = document.createElement('div');
        row.className = 'admin-toc-editor-row';
        const levelVal = Math.min(6, Math.max(1, Number(node.level) || 1));
        row.style.setProperty('--toc-indent', String(levelVal - 1));

        const idxSpan = document.createElement('span');
        idxSpan.className = 'admin-toc-row-idx';
        idxSpan.textContent = `#${i + 1}`;

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.className = 'admin-toc-editor-title';
        titleInput.maxLength = ADMIN_TOC_MAX_TITLE_LENGTH;
        titleInput.placeholder = t('adminTocColTitle');
        titleInput.setAttribute('aria-label', t('adminTocColTitle'));
        titleInput.value = node.title ?? '';
        titleInput.addEventListener('input', () => {
          adminTocEditorNodes[i].title = titleInput.value;
        });

        const levelSelect = document.createElement('select');
        levelSelect.setAttribute('aria-label', t('adminTocColLevel'));
        for (let lv = 1; lv <= 6; lv += 1) {
          const opt = document.createElement('option');
          opt.value = String(lv);
          opt.textContent = `L${lv}`;
          opt.selected = levelVal === lv;
          levelSelect.append(opt);
        }
        levelSelect.addEventListener('change', () => {
          const nextLv = Number(levelSelect.value) || 1;
          adminTocEditorNodes[i].level = nextLv;
          row.style.setProperty('--toc-indent', String(Math.max(0, nextLv - 1)));
        });

        const pageInput = document.createElement('input');
        pageInput.type = 'number';
        pageInput.min = '1';
        const totalPages = adminTocTotalPages(adminTocDetail);
        if (totalPages) pageInput.max = String(totalPages);
        pageInput.setAttribute('aria-label', t('adminTocColPage'));
        pageInput.value = String(node.page_pdf ?? 1);
        pageInput.addEventListener('input', () => {
          adminTocEditorNodes[i].page_pdf = pageInput.value === '' ? '' : Number(pageInput.value);
        });

        const btns = document.createElement('div');
        btns.className = 'admin-toc-row-btns';

        const makeMini = (label, onClick, disabled = false) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'admin-toc-mini-btn';
          b.textContent = label;
          b.disabled = disabled;
          b.addEventListener('click', onClick);
          return b;
        };

        btns.append(
          makeMini(t('adminTocJumpPage'), () => void renderAdminTocPdfPage(Number(pageInput.value) || 1)),
          makeMini('↑', () => {
            adminTocEditorNodes = adminTocMoveNode(adminTocEditorNodes, i, -1);
            renderAdminTocEditorRows();
          }, i === 0),
          makeMini('↓', () => {
            adminTocEditorNodes = adminTocMoveNode(adminTocEditorNodes, i, 1);
            renderAdminTocEditorRows();
          }, i === adminTocEditorNodes.length - 1),
          makeMini(t('adminTocInsertBelow'), () => {
            adminTocEditorNodes = adminTocInsertNode(adminTocEditorNodes, i, {
              level: Number(levelSelect.value) || 1,
              page_pdf: Math.max(1, Number(pageInput.value) || 1)
            });
            renderAdminTocEditorRows();
          }),
          makeMini(t('adminTocRemoveNode'), () => {
            adminTocEditorNodes = adminTocRemoveNode(adminTocEditorNodes, i);
            renderAdminTocEditorRows();
          })
        );

        row.append(idxSpan, titleInput, levelSelect, pageInput, btns);
        container.append(row);
      }
    }

    function renderAdminTocDetail(keepEditor = false) {
      const detail = adminTocDetail;
      if (!detail) return;
      const titleEl = $('#admin-toc-detail-title');
      const metaEl = $('#admin-toc-detail-meta');
      const autoInfoEl = $('#admin-toc-auto-info');
      const autoTreeEl = $('#admin-toc-auto-tree');
      const noteInput = $('#admin-toc-note');
      if (!titleEl || !metaEl || !autoInfoEl || !autoTreeEl || !noteInput) return;

      titleEl.textContent = detail.standard_code_display
        ? `${detail.standard_code_display} — ${detail.document_title || detail.original_filename}`
        : (detail.document_title || detail.original_filename || detail.file_id);

      metaEl.replaceChildren();
      const totalPages = adminTocTotalPages(detail);
      const topLine = document.createElement('div');
      topLine.textContent = [
        t('standardVersion', { n: detail.version ?? '?' }) + (detail.version_label ? ` (${detail.version_label})` : ''),
        detail.original_filename || '',
        totalPages ? `${totalPages} ${t('pagesUnit')}` : '',
        `auto: ${adminTocAutoStatusLabel(detail.auto_status)}`,
        `job: ${adminTocJobStatusLabel(detail.job_status)}`,
        detail.algorithm_version ? `algo: ${detail.algorithm_version}` : '',
        detail.current_algorithm_version ? t('adminTocCurrentAlgo', { ver: detail.current_algorithm_version }) : ''
      ].filter(Boolean).join(' · ');
      metaEl.append(topLine);

      const manualStateLine = document.createElement('div');
      const manualNodes = Array.isArray(detail.manual_payload?.nodes) ? detail.manual_payload.nodes : [];
      if (detail.manual_override === true) {
        manualStateLine.textContent = manualNodes.length === 0
          ? t('adminTocManualHiddenActive')
          : t('adminTocManualActive', { count: manualNodes.length });
      } else {
        manualStateLine.textContent = t('adminTocManualNone');
      }
      metaEl.append(manualStateLine);

      if (detail.last_error) {
        const errLine = document.createElement('div');
        errLine.textContent = t('adminTocLastError', { err: detail.last_error });
        metaEl.append(errLine);
      }

      autoInfoEl.replaceChildren();
      const autoPayload = detail.auto_payload;
      const autoFlags = Array.isArray(detail.auto_flags) && detail.auto_flags.length > 0
        ? detail.auto_flags
        : (Array.isArray(autoPayload?.flags) ? autoPayload.flags : []);
      if (autoFlags.length > 0) {
        const p = document.createElement('span');
        p.textContent = t('adminTocAutoFlags', { flags: autoFlags.join(', ') });
        autoInfoEl.append(p);
      }
      if (autoPayload?.reason) {
        const p = document.createElement('span');
        p.textContent = t('adminTocAutoReason', { reason: autoPayload.reason });
        autoInfoEl.append(p);
      }
      const needsOcr = Array.isArray(autoPayload?.needsOcrPages) ? autoPayload.needsOcrPages : [];
      if (needsOcr.length > 0) {
        const p = document.createElement('span');
        p.textContent = t('adminTocNeedsOcrPages', { pages: needsOcr.join(', ') });
        autoInfoEl.append(p);
      }

      autoTreeEl.replaceChildren();
      const rawAutoNodes = Array.isArray(autoPayload?.nodes) ? autoPayload.nodes : [];
      if (rawAutoNodes.length === 0) {
        const li = document.createElement('li');
        li.className = 'doc-viewer-toc-status';
        li.textContent = t('adminTocAutoEmpty');
        autoTreeEl.append(li);
      } else {
        const autoTree = buildTocTree(rawAutoNodes, { includeFirstPage: false, previewOnly: false });
        const renderAutoTree = () => {
          const items = createTocListDom(document, autoTree, {
            collapsedIds: adminTocAutoCollapsedIds,
            labels: { expand: t('tocExpand'), collapse: t('tocCollapse') },
            onToggleCollapse: (nodeId) => {
              if (adminTocAutoCollapsedIds.has(nodeId)) adminTocAutoCollapsedIds.delete(nodeId);
              else adminTocAutoCollapsedIds.add(nodeId);
              renderAutoTree();
            },
            onJump: (page) => void renderAdminTocPdfPage(page)
          });
          autoTreeEl.replaceChildren(...items);
        };
        renderAutoTree();
      }

      if (!keepEditor) {
        adminTocEditorNodes = manualNodes.map((n) => ({
          title: String(n.title ?? ''),
          level: Math.min(6, Math.max(1, Number(n.level) || 1)),
          page_pdf: Math.max(1, Number(n.page_pdf) || 1)
        }));
        noteInput.value = detail.manual_payload?.note ?? '';
      }
      renderAdminTocEditorRows();

      $('#admin-toc-promote-btn').disabled = rawAutoNodes.length === 0;
      $('#admin-toc-delete-btn').disabled = !(detail.manual_override === true || detail.manual_payload !== null);
      $('#admin-toc-reextract-btn').disabled = !canReextractToc(detail);
    }

    async function loadAdminTocDetail(fileId) {
      const listPanel = $('#admin-tocs-list-panel');
      const detailPanel = $('#admin-tocs-detail-panel');
      const detailErr = $('#admin-toc-detail-error');
      const editorErr = $('#admin-toc-editor-error');
      const path = adminFileTocPath(fileId);
      if (!listPanel || !detailPanel || !path) return;
      if (!canManageAdminTocs(elibUser)) {
        void loadAdminTocsList();
        return;
      }

      listPanel.hidden = true;
      detailPanel.hidden = false;
      detailErr.hidden = true;
      editorErr.hidden = true;
      const seq = ++adminTocDetailSeq;
      const result = await elibFetchJson(path);
      if (seq !== adminTocDetailSeq) return;

      if (result.status !== 200 || !result.payload) {
        detailErr.hidden = false;
        detailErr.textContent = formatAdminTocError(result, t);
        return;
      }

      adminTocAutoCollapsedIds = new Set();
      adminTocDetail = result.payload;
      renderAdminTocDetail(false);
      void loadAdminTocPdf(adminTocDetail);
    }

    async function loadAdminTocsView() {
      const detailPanel = $('#admin-tocs-detail-panel');
      if (detailPanel && !detailPanel.hidden && adminTocDetail && canManageAdminTocs(elibUser)) {
        await loadAdminTocDetail(adminTocDetail.file_id);
        return;
      }
      await loadAdminTocsList();
    }

    $('#admin-tocs-filters')?.addEventListener('submit', (event) => {
      event.preventDefault();
      adminTocListState.offset = 0;
      void loadAdminTocsList();
    });
    $('#admin-toc-filter-reset')?.addEventListener('click', () => {
      $('#admin-toc-filter-auto-status').value = '';
      $('#admin-toc-filter-job-status').value = '';
      $('#admin-toc-filter-flag').value = '';
      $('#admin-toc-filter-manual').value = '';
      $('#admin-toc-filter-standards').value = '';
      $('#admin-toc-filter-outdated').checked = false;
      adminTocListState.offset = 0;
      void loadAdminTocsList();
    });
    $('#admin-tocs-prev')?.addEventListener('click', () => {
      adminTocListState.offset = Math.max(0, adminTocListState.offset - adminTocListState.limit);
      void loadAdminTocsList();
    });
    $('#admin-tocs-next')?.addEventListener('click', () => {
      adminTocListState.offset += adminTocListState.limit;
      void loadAdminTocsList();
    });
    $('#admin-toc-back')?.addEventListener('click', () => {
      adminTocDetail = null;
      adminTocEditorNodes = [];
      destroyAdminTocPdf();
      $('#admin-tocs-detail-panel').hidden = true;
      $('#admin-tocs-list-panel').hidden = false;
      void loadAdminTocsList({ keepView: true });
    });
    $('#admin-toc-add-node-btn')?.addEventListener('click', () => {
      const last = adminTocEditorNodes[adminTocEditorNodes.length - 1];
      adminTocEditorNodes = adminTocInsertNode(adminTocEditorNodes, adminTocEditorNodes.length - 1, {
        level: last ? last.level : 1,
        page_pdf: adminTocPdfState?.currentPage || (last ? last.page_pdf : 1)
      });
      renderAdminTocEditorRows();
    });
    $('#admin-toc-clear-nodes-btn')?.addEventListener('click', () => {
      adminTocEditorNodes = [];
      renderAdminTocEditorRows();
    });
    $('#admin-toc-save-btn')?.addEventListener('click', async () => {
      if (!adminTocDetail) return;
      const errBox = $('#admin-toc-editor-error');
      errBox.hidden = true;
      const totalPages = adminTocTotalPages(adminTocDetail);
      const validation = validateAdminTocNodes(adminTocEditorNodes, totalPages, $('#admin-toc-note').value);
      if (!validation.ok) {
        errBox.hidden = false;
        errBox.textContent = t(validation.error.key, validation.error.vars || {});
        return;
      }
      if (validation.payload.nodes.length === 0 && !confirm(t('adminTocSaveEmptyConfirm'))) {
        return;
      }
      const req = adminTocActionRequest('save', adminTocDetail.file_id, validation.payload);
      if (!req) return;
      const btn = $('#admin-toc-save-btn');
      btn.disabled = true;
      const result = await elibFetchJson(req.path, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body
      });
      btn.disabled = false;
      if (result.status === 200) {
        showToast(t('adminTocSaved'));
        void loadAdminTocDetail(adminTocDetail.file_id);
        return;
      }
      errBox.hidden = false;
      errBox.textContent = formatAdminTocError(result, t);
    });
    $('#admin-toc-promote-btn')?.addEventListener('click', async () => {
      if (!adminTocDetail) return;
      const errBox = $('#admin-toc-editor-error');
      errBox.hidden = true;
      const req = adminTocActionRequest('promote', adminTocDetail.file_id, {
        activate: true,
        note: $('#admin-toc-note').value.trim() || null
      });
      if (!req) return;
      const btn = $('#admin-toc-promote-btn');
      btn.disabled = true;
      const result = await elibFetchJson(req.path, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body
      });
      btn.disabled = false;
      if (result.status === 200) {
        showToast(t('adminTocPromoted'));
        void loadAdminTocDetail(adminTocDetail.file_id);
        return;
      }
      errBox.hidden = false;
      errBox.textContent = formatAdminTocError(result, t);
    });
    $('#admin-toc-delete-btn')?.addEventListener('click', async () => {
      if (!adminTocDetail) return;
      if (!confirm(t('adminTocDeleteManualConfirm'))) return;
      const errBox = $('#admin-toc-editor-error');
      errBox.hidden = true;
      const req = adminTocActionRequest('delete', adminTocDetail.file_id);
      if (!req) return;
      const btn = $('#admin-toc-delete-btn');
      btn.disabled = true;
      const result = await elibFetchJson(req.path, { method: req.method });
      btn.disabled = false;
      if (result.status === 200) {
        showToast(t('adminTocDeleted'));
        void loadAdminTocDetail(adminTocDetail.file_id);
        return;
      }
      errBox.hidden = false;
      errBox.textContent = formatAdminTocError(result, t);
    });
    $('#admin-toc-reextract-btn')?.addEventListener('click', async () => {
      if (!adminTocDetail || !canReextractToc(adminTocDetail)) return;
      const errBox = $('#admin-toc-editor-error');
      errBox.hidden = true;
      const req = adminTocActionRequest('reextract', adminTocDetail.file_id);
      if (!req) return;
      const btn = $('#admin-toc-reextract-btn');
      btn.disabled = true;
      const result = await elibFetchJson(req.path, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
        body: req.body
      });
      if (result.status === 200) {
        showToast(t('adminTocReextractQueued'));
        void loadAdminTocDetail(adminTocDetail.file_id);
        return;
      }
      btn.disabled = !canReextractToc(adminTocDetail);
      errBox.hidden = false;
      errBox.textContent = formatAdminTocError(result, t);
    });
    $('#admin-toc-pdf-prev')?.addEventListener('click', () => {
      if (!adminTocPdfState) return;
      void renderAdminTocPdfPage((adminTocPdfState.currentPage || 1) - 1);
    });
    $('#admin-toc-pdf-next')?.addEventListener('click', () => {
      if (!adminTocPdfState) return;
      void renderAdminTocPdfPage((adminTocPdfState.currentPage || 1) + 1);
    });
    $('#admin-toc-pdf-page-input')?.addEventListener('change', (event) => {
      void renderAdminTocPdfPage(Number(event.target.value) || 1);
    });

    // ---- Đăng ký / đổi mật khẩu / quản trị người dùng (Giai đoạn B3) ----
    function setPendingBadge(count) {
      const badge = $('#nav-pending-count');
      if (!badge) return;
      badge.hidden = !(count > 0);
      badge.textContent = String(count || 0);
      const sectionCount = $('#admin-pending-count');
      if (sectionCount) sectionCount.textContent = String(count || 0);
    }

    async function refreshPendingBadge() {
      const result = await elibFetchJson('/admin/users?status=pending');
      if (result.status === 200 && result.payload) setPendingBadge(result.payload.pendingCount ?? 0);
    }

    function adminUserMetaLine(user) {
      const parts = [
        user.username ? `@${user.username}` : '',
        user.full_name || '',
        user.organization || '',
        user.email || '',
        user.created_at ? `${t('adminRegisteredAt')}: ${formatDateTime(user.created_at)}` : ''
      ].filter(Boolean);
      return parts.join(' · ');
    }

    function makeAdminButton(labelKey, className, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = className;
      btn.textContent = t(labelKey);
      btn.addEventListener('click', onClick);
      return btn;
    }

    async function adminAction(path, options, successKey) {
      const result = await elibFetchJson(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (result.status >= 200 && result.status < 300) {
        if (successKey) showToast(t(successKey));
        return result;
      }
      showToast(t(adminErrorKey(result.status ?? 0, result.errorCode || null)));
      return null;
    }

    function renderPendingUser(user) {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'admin-pending-check';
      checkbox.dataset.userId = user.id;
      checkbox.setAttribute('aria-label', user.email || user.username || '');
      const main = document.createElement('div');
      main.className = 'lib-main';
      const strong = document.createElement('strong');
      strong.textContent = dash(user.full_name || user.display_name || user.username || user.email);
      const small = document.createElement('small');
      small.textContent = adminUserMetaLine(user);
      main.append(strong, small);
      if (user.email_domain_internal) {
        const hint = document.createElement('span');
        hint.className = 'badge badge-internal-hint';
        hint.textContent = t('adminInternalEmailHint');
        main.append(hint);
      }
      const actions = document.createElement('div');
      actions.className = 'admin-user-actions';
      const typeSelect = document.createElement('select');
      typeSelect.className = 'admin-user-type-select';
      typeSelect.setAttribute('aria-label', t('adminUserTypeLabel'));
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = t('adminSelectUserType');
      typeSelect.append(placeholder);
      for (const value of ['internal', 'external']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(value === 'internal' ? 'userTypeInternal' : 'userTypeExternal');
        typeSelect.append(option);
      }
      const approveBtn = makeAdminButton('adminApprove', 'button button-terracotta button-small', async () => {
        if (!typeSelect.value) { showToast(t('adminErrUserType')); return; }
        const result = await adminAction(`/admin/users/${encodeURIComponent(user.id)}/approve`, {
          body: JSON.stringify({ user_type: typeSelect.value })
        }, 'adminApproved');
        if (result) void loadAdminUsersView();
      });
      approveBtn.disabled = true;
      typeSelect.addEventListener('change', () => { approveBtn.disabled = !typeSelect.value; });
      const reasonInput = document.createElement('input');
      reasonInput.type = 'text';
      reasonInput.maxLength = 500;
      reasonInput.className = 'admin-reject-reason-input';
      reasonInput.placeholder = t('adminRejectReasonLabel');
      reasonInput.setAttribute('aria-label', t('adminRejectReasonLabel'));
      const rejectBtn = makeAdminButton('adminReject', 'button button-secondary button-small', async () => {
        const reason = reasonInput.value.trim();
        if (!reason) { showToast(t('adminRejectReasonRequired')); return; }
        const result = await adminAction(`/admin/users/${encodeURIComponent(user.id)}/reject`, {
          body: JSON.stringify({ reason })
        }, 'adminRejected');
        if (result) void loadAdminUsersView();
      });
      actions.append(typeSelect, approveBtn, reasonInput, rejectBtn);
      row.append(checkbox, main, actions);
      return row;
    }

    function renderManagedUser(user) {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      const main = document.createElement('div');
      main.className = 'lib-main';
      const strong = document.createElement('strong');
      strong.textContent = dash(user.full_name || user.display_name || user.username || user.email);
      const small = document.createElement('small');
      small.textContent = adminUserMetaLine(user);
      main.append(strong, small);
      const actions = document.createElement('div');
      actions.className = 'admin-user-actions';
      const patchUser = async (patch) => {
        const result = await adminAction(`/admin/users/${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(patch)
        }, 'adminUpdated');
        if (result) void loadAdminUsersView();
        return result;
      };
      const roleSelect = document.createElement('select');
      roleSelect.setAttribute('aria-label', t('adminRoleLabel'));
      for (const role of roleOptionsForUser(user)) {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = t(role === 'admin' ? 'roleAdmin' : role === 'editor' ? 'roleEditor' : 'roleViewer');
        option.selected = user.role === role;
        roleSelect.append(option);
      }
      roleSelect.addEventListener('change', () => void patchUser({ role: roleSelect.value }));
      const typeSelect = document.createElement('select');
      typeSelect.setAttribute('aria-label', t('adminUserTypeLabel'));
      for (const value of ['internal', 'external']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(value === 'internal' ? 'userTypeInternal' : 'userTypeExternal');
        option.selected = user.user_type === value;
        typeSelect.append(option);
      }
      typeSelect.addEventListener('change', () => void patchUser({ user_type: typeSelect.value }));
      actions.append(roleSelect, typeSelect);
      if (user.status === 'active') {
        actions.append(makeAdminButton('adminDisable', 'button button-secondary button-small', () => void patchUser({ status: 'disabled' })));
      } else if (user.status === 'disabled') {
        actions.append(makeAdminButton('adminEnable', 'button button-secondary button-small', () => void patchUser({ status: 'active' })));
      }
      actions.append(makeAdminButton('adminResetPassword', 'button button-secondary button-small', async () => {
        const result = await adminAction(`/admin/users/${encodeURIComponent(user.id)}/reset-password`, { body: '{}' });
        const temp = result?.payload?.temporaryPassword;
        if (temp) {
          $('#temp-password-value').textContent = temp;
          $('#temp-password-modal').hidden = false;
        }
      }));
      actions.append(makeAdminButton('adminUnlock', 'button button-secondary button-small', async () => {
        await adminAction(`/admin/users/${encodeURIComponent(user.id)}/unlock`, { body: '{}' }, 'adminUnlocked');
      }));
      row.append(main, actions);
      return row;
    }

    async function loadAdminUsersView() {
      const banner = $('#admin-users-banner');
      banner.hidden = true;
      if (!isAdminUser(elibUser)) {
        banner.hidden = false;
        banner.textContent = t('adminErrForbidden');
        return;
      }
      $('#admin-users-loading').hidden = false;
      const pending = await elibFetchJson('/admin/users?status=pending');
      const filterStatus = $('#admin-status-filter').value || 'active';
      const managed = await elibFetchJson(`/admin/users?status=${encodeURIComponent(filterStatus)}`);
      $('#admin-users-loading').hidden = true;
      if (pending.status !== 200 || !pending.payload) {
        banner.hidden = false;
        banner.textContent = pending.status === 401 || pending.status === 403
          ? t(adminErrorKey(pending.status, pending.errorCode || null))
          : t('adminLoadFailed');
        return;
      }
      setPendingBadge(pending.payload.pendingCount ?? (pending.payload.users || []).length);
      const pendingList = $('#admin-pending-list');
      pendingList.replaceChildren();
      for (const user of pending.payload.users || []) pendingList.append(renderPendingUser(user));
      $('#admin-pending-empty').hidden = (pending.payload.users || []).length !== 0;
      $('#admin-bulk-bar').hidden = (pending.payload.users || []).length === 0;
      const manageList = $('#admin-manage-list');
      manageList.replaceChildren();
      const managedUsers = managed.status === 200 && managed.payload ? (managed.payload.users || []) : [];
      for (const user of managedUsers) manageList.append(renderManagedUser(user));
      $('#admin-manage-empty').hidden = managedUsers.length !== 0;
    }

    $('#admin-status-filter').addEventListener('change', () => void loadAdminUsersView());
    $('#admin-bulk-reject').addEventListener('click', async () => {
      const ids = $$('.admin-pending-check').filter(box => box.checked).map(box => box.dataset.userId).filter(Boolean);
      if (ids.length === 0) { showToast(t('adminSelectUserFirst')); return; }
      const reason = $('#admin-bulk-reason').value.trim();
      if (!reason) { showToast(t('adminRejectReasonRequired')); return; }
      const result = await adminAction('/admin/users/bulk-reject', {
        body: JSON.stringify({ ids, reason })
      });
      if (result) {
        showToast(t('adminBulkRejected', { n: result.payload?.rejected ?? ids.length }));
        void loadAdminUsersView();
      }
    });
    $('#temp-password-close').addEventListener('click', () => {
      $('#temp-password-modal').hidden = true;
      $('#temp-password-value').textContent = '';
    });
    $('#temp-password-modal').addEventListener('click', event => {
      if (event.target === event.currentTarget) {
        event.currentTarget.hidden = true;
        $('#temp-password-value').textContent = '';
      }
    });
    $('#temp-password-copy').addEventListener('click', async () => {
      const value = $('#temp-password-value').textContent;
      if (!value) return;
      try { await navigator.clipboard.writeText(value); showToast(t('copied')); } catch { showToast(t('copyFailed')); }
    });

    $('#elib-show-register').addEventListener('click', () => {
      $('#elib-login-box').hidden = true;
      $('#elib-register-box').hidden = false;
    });
    $('#elib-show-login').addEventListener('click', () => {
      $('#elib-register-box').hidden = true;
      $('#elib-login-box').hidden = false;
    });
    $('#elib-register-form').addEventListener('submit', async event => {
      event.preventDefault();
      const errorBox = $('#elib-register-error');
      const successBox = $('#elib-register-success');
      errorBox.hidden = true;
      successBox.hidden = true;
      const input = {
        username: $('#reg-username').value.trim(),
        password: $('#reg-password').value,
        passwordConfirm: $('#reg-password-confirm').value,
        displayName: $('#reg-displayname').value.trim(),
        fullName: $('#reg-fullname').value.trim(),
        organization: $('#reg-organization').value.trim(),
        email: $('#reg-email').value.trim()
      };
      const localError = validateRegistration(input);
      if (localError) {
        errorBox.hidden = false;
        errorBox.textContent = t(localError);
        return;
      }
      const submit = $('#elib-register-submit');
      submit.disabled = true;
      const result = await elibFetchJson('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          displayName: input.displayName || undefined,
          fullName: input.fullName,
          organization: input.organization || undefined,
          email: input.email,
          website: $('#reg-website').value
        })
      });
      submit.disabled = false;
      if (result.status === 201) {
        $('#elib-register-form').reset();
        successBox.hidden = false;
        successBox.textContent = t('regSuccess');
        return;
      }
      errorBox.hidden = false;
      errorBox.textContent = t(registerErrorKey(result.status ?? 0, result.errorCode || null));
    });
    $('#elib-change-password-form').addEventListener('submit', async event => {
      event.preventDefault();
      const errorBox = $('#elib-change-password-error');
      errorBox.hidden = true;
      const pairError = passwordPairErrorKey($('#cp-new').value, $('#cp-confirm').value);
      if (pairError) {
        errorBox.hidden = false;
        errorBox.textContent = t(pairError);
        return;
      }
      const submit = $('#elib-change-password-submit');
      submit.disabled = true;
      const result = await elibFetchJson('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: $('#cp-current').value, newPassword: $('#cp-new').value })
      });
      submit.disabled = false;
      if (result.status === 200) {
        $('#elib-change-password-form').reset();
        showToast(t('changeSuccess'));
        void loadDocumentsView();
        void loadHomeRecent();
        return;
      }
      errorBox.hidden = false;
      errorBox.textContent = t(changePasswordErrorKey(result.status ?? 0, result.errorCode || null));
    });

    // ---- Init from URL ----
    applyLanguage(currentLang);
    updateLibraryNavBadge();
    void loadUiConfig();
    void refreshElibAuth().then(() => openDeepLinkFromHash());
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    if (view === 'detail' && params.get('code')) {
      showView('detail', false);
      void requestDetail(params.get('code'), params.get('source') || '');
    } else if (view === 'search' && params.get('q')) {
      searchInput.value = params.get('q');
      searchPage.value = params.get('page') || '1';
      showView('search', false);
      void searchStandards();
    } else if (['categories', 'documents', 'library', 'search', 'detail', 'admin-users', 'admin-tocs'].includes(view)) {
      showView(view, false);
    } else {
      showView('home', false);
    }
  }

  initApp();
})();
