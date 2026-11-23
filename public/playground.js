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

  const fileHelpers = { fileKindFromName, needsLoginForDoc, formatFileSize, elibDownloadPath, elibPreviewPath, elibViewPath, previewAffordance, previewErrorKey, downloadAffordance, viewerToolbar, downloadErrorKey, filenameFromDisposition, endOfPreviewKind, previewStateKey, parseDocDeepLink, docDeepLinkHash, canChangeVisibility, visibilityErrorKey, normalizeContact, passwordPairErrorKey, validateRegistration, registerErrorKey, loginErrorKey, changePasswordErrorKey, adminErrorKey, isAdminUser, roleOptionsForUser };

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
        visInternal: 'Nội bộ', visPublic: 'Công khai', visPrivate: 'Riêng tư', elibStatus: 'Trạng thái',
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
        visibilityLabel: 'Mức hiển thị', visibilityPublic: 'Công khai', visibilityInternal: 'Nội bộ', visibilityPrivate: 'Riêng tư',
        visibilityUpdated: 'Đã đổi mức hiển thị.', visibilityLoginRequired: 'Vui lòng đăng nhập để đổi mức hiển thị.',
        visibilityForbidden: 'Bạn không có quyền đổi mức hiển thị của tài liệu này.', visibilityInvalid: 'Mức hiển thị không hợp lệ.',
        visibilityNotFound: 'Không tìm thấy tài liệu.', visibilityFailed: 'Không đổi được mức hiển thị. Vui lòng thử lại sau.',
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
        visInternal: 'Internal', visPublic: 'Public', visPrivate: 'Private', elibStatus: 'Status',
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
        visibilityLabel: 'Visibility', visibilityPublic: 'Public', visibilityInternal: 'Internal', visibilityPrivate: 'Private',
        visibilityUpdated: 'Visibility updated.', visibilityLoginRequired: 'Please sign in to change visibility.',
        visibilityForbidden: 'You do not have permission to change this document\'s visibility.', visibilityInvalid: 'Invalid visibility value.',
        visibilityNotFound: 'Document not found.', visibilityFailed: 'Could not change visibility. Please try again later.',
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
      for (const value of ['public', 'internal', 'private']) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = t(`visibility${value[0].toUpperCase()}${value.slice(1)}`);
        select.append(option);
      }
      select.value = ['public', 'internal', 'private'].includes(doc.visibility) ? doc.visibility : 'internal';
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
        select.value = ['public', 'internal', 'private'].includes(previous) ? previous : 'internal';
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

    function closeDocViewer() {
      const overlay = $('#doc-viewer');
      if (overlay) overlay.hidden = true;
      viewerDocId = null;
      viewerDoc = null;
      clearDocDeepLink();
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
        viewerState = { loadingTask, doc, mode };
        const pdf = await loadingTask.promise;
        statusEl.hidden = true;
        const total = pdf.numPages;
        if (mode !== 'preview') {
          pageInfoEl.textContent = t('viewerPage', { n: total, total });
        }
        // Render pages sequentially; preview PDFs are small, full PDFs
        // render on scroll via IntersectionObserver to stay responsive.
        const renderPage = async (pageNum, canvas) => {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        };
        const canvases = [];
        for (let n = 1; n <= total; n += 1) {
          const canvas = document.createElement('canvas');
          canvas.className = 'viewer-page';
          canvas.dataset.page = String(n);
          pagesEl.append(canvas);
          canvases.push(canvas);
        }
        const observer = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const canvas = entry.target;
            observer.unobserve(canvas);
            void renderPage(Number(canvas.dataset.page), canvas).catch(() => undefined);
          }
        }, { root: pagesEl, rootMargin: '400px' });
        canvases.forEach((c) => observer.observe(c));
        if (viewerState) viewerState.observer = observer;

        if (mode === 'preview') {
          // End-of-preview panel: no scrolling past the cut pages exists
          // (the preview PDF simply has no more pages). Contact channel
          // comes from /api/v1/ui-config (env phía Reverse_proxy);
          // empty config -> generic sentence only. No price is shown.
          const kind = endOfPreviewKind(elibUser);
          $('#doc-viewer-end-text').textContent = kind === 'login' ? t('previewEndLogin') : t('previewEndContact');
          $('#doc-viewer-end-login').hidden = kind !== 'login';
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
        }
      } catch (error) {
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
        codeBtn.addEventListener('click', () => openDetail(record.code, record.source));
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
        detailBtn.addEventListener('click', () => openDetail(record.code, record.source));
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
      errorBox.hidden = !result.errorMessage;
      errorBox.textContent = result.errorMessage ? `${t('requestFailed')}: ${result.errorMessage}` : '';
      groups.hidden = true;
      empty.hidden = false;
      currentDetail = null;
      if (!result.ok || !result.payload?.data || typeof result.payload.data !== 'object') {
        empty.querySelector('strong').textContent = result.errorMessage || t('requestFailed');
        empty.querySelector('p').textContent = t('detailEmptyText');
        return;
      }
      const data = result.payload.data;
      currentDetail = data;
      const model = buildDetailViewModel(data);
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

    async function requestDetail(codeOverride, sourceOverride) {
      const code = String(codeOverride ?? detailInput.value).trim().replace(/\s+/g, ' ');
      if (!code) { showToast(t('enterCode')); detailInput.focus(); return; }
      detailInput.value = code;
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

    function openDetail(code, source) {
      if (!code) return;
      showView('detail', false);
      void requestDetail(code, source || '');
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
          openBtn.addEventListener('click', () => openDetail(item.code, item.source));
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
      const pagesEl = $('#doc-viewer-pages');
      const canvases = [...pagesEl.querySelectorAll('canvas')];
      if (canvases.length === 0) return;
      const current = canvases.findIndex((c) => c.offsetTop + c.offsetHeight > pagesEl.scrollTop + 10);
      const target = canvases[Math.min(canvases.length - 1, Math.max(0, (current < 0 ? 0 : current) + delta))];
      if (target) pagesEl.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
    };
    $('#doc-viewer-prev').addEventListener('click', () => scrollViewerPage(-1));
    $('#doc-viewer-next').addEventListener('click', () => scrollViewerPage(1));
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
    } else if (['categories', 'documents', 'library', 'search', 'detail', 'admin-users'].includes(view)) {
      showView(view, false);
    } else {
      showView('home', false);
    }
  }

  initApp();
})();
