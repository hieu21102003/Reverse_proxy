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

  if (typeof document === 'undefined') {
    globalThis.__vsqiDetailModel = detailModel;
    return;
  }

  function initApp() {
    const searchForm = document.querySelector('#search-form');
    const detailForm = document.querySelector('#detail-form');
    const searchInput = document.querySelector('#search-query');
    const searchPage = document.querySelector('#search-page');
    const detailInput = document.querySelector('#detail-code');
    const apiBaseInput = document.querySelector('#api-base-url');
    const memory = { search: null, detail: null };
    let toastTimer;

    const cleanBase = value => value.trim().replace(/\/+$/, '');
    let savedBase = '';
    try {
      savedBase = localStorage.getItem('vsqi-api-base-url') || '';
    } catch {
      savedBase = '';
    }
    const initialBase = new URLSearchParams(location.search).get('apiBaseUrl') || savedBase || location.origin;
    apiBaseInput.value = cleanBase(initialBase);

    function getBaseUrl() {
      const value = cleanBase(apiBaseInput.value || location.origin);
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
        if (url.username || url.password || url.search || url.hash) throw new Error('The API base URL cannot contain credentials, a query, or a fragment');
        if (location.protocol === 'https:' && url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
          throw new Error('An HTTPS playground cannot call an insecure HTTP API');
        }
        return cleanBase(url.href);
      } catch (error) {
        throw new Error(error.message === 'An HTTPS playground cannot call an insecure HTTP API'
          ? error.message
          : error.message === 'The API base URL cannot contain credentials, a query, or a fragment'
            ? error.message
            : 'Enter a valid API base URL, such as https://api.example.com');
      }
    }

    function showToast(message) {
      const toast = document.querySelector('#toast');
      toast.textContent = message;
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2200);
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[character]);
    }

    function highlightJson(raw) {
      const tokenPattern = /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false)\b|\bnull\b)/g;
      let output = '';
      let lastIndex = 0;
      for (const match of raw.matchAll(tokenPattern)) {
        const token = match[0];
        output += escapeHtml(raw.slice(lastIndex, match.index));
        const className = token === 'null'
          ? 'json-null'
          : token === 'true' || token === 'false'
            ? 'json-boolean'
            : token.startsWith('"')
              ? /"\s*:$/.test(token) ? 'json-key' : 'json-string'
              : 'json-number';
        output += `<span class="${className}">${escapeHtml(token)}</span>`;
        lastIndex = match.index + token.length;
      }
      return output + escapeHtml(raw.slice(lastIndex));
    }

    function renderRaw(kind, raw) {
      const viewer = document.querySelector(`#${kind}-raw-json`);
      viewer.innerHTML = highlightJson(raw);
    }

    function makeStatusBadge(value, forcedTone) {
      const badge = document.createElement('span');
      const tone = forcedTone || statusTone(value);
      badge.className = `badge badge-${tone}`;
      badge.textContent = valueText(value);
      return badge;
    }

    function showView(name) {
      document.querySelectorAll('.view-panel').forEach(panel => {
        const isVisible = panel.id === `view-${name}`;
        panel.hidden = !isVisible;
        panel.classList.toggle('is-visible', isVisible);
      });
      document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('is-active', button.dataset.view === name));
      const headings = { search: 'Search standards', detail: 'Standard detail', docs: 'API reference' };
      document.querySelector('#breadcrumb-current').textContent = headings[name];
      document.querySelector('.sidebar').classList.remove('is-open');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updateInspector(kind, requestUrl, result) {
      document.querySelector(`#${kind}-inspector`).hidden = false;
      document.querySelector(`#${kind}-timestamp`).textContent = result.timestamp;
      document.querySelector(`#${kind}-request-url`).textContent = requestUrl;
      document.querySelector(`#${kind}-http-status`).textContent = result.status === null ? 'Network error' : `${result.status} ${result.statusText}`;
      document.querySelector(`#${kind}-http-status`).className = `status-value ${result.ok ? 'status-ok' : 'status-error'}`;
      document.querySelector(`#${kind}-response-time`).textContent = `${result.duration.toFixed(1)} ms`;
      const errorBanner = document.querySelector(`#${kind}-error`);
      errorBanner.hidden = !result.errorMessage;
      errorBanner.textContent = result.errorMessage ? `Request failed: ${result.errorMessage}` : '';
    }

    async function requestApi(kind, path) {
      const started = performance.now();
      const timestamp = new Date().toLocaleString();
      const button = document.querySelector(kind === 'search' ? '#search-submit' : '#detail-form button[type="submit"]');
      const url = `${getBaseUrl()}${path}`;
      button.disabled = true;
      button.classList.add('is-loading');
      button.dataset.originalLabel ||= button.querySelector('span').textContent;
      button.querySelector('span').textContent = 'Sending…';

      try {
        const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
        const raw = await response.text();
        const duration = performance.now() - started;
        let payload;
        let errorMessage = '';
        try {
          payload = JSON.parse(raw);
          if (!response.ok) errorMessage = payload?.error?.message || `HTTP ${response.status}`;
          if (response.ok && kind === 'search'
            && (!Array.isArray(payload?.data) || !payload?.pagination || typeof payload.pagination !== 'object')) {
            errorMessage = 'The API returned an unexpected search response structure';
          }
          if (response.ok && kind === 'detail' && (!payload?.data || typeof payload.data !== 'object' || Array.isArray(payload.data))) {
            errorMessage = 'The API returned an unexpected detail response structure';
          }
        } catch {
          errorMessage = `The API returned a non-JSON response (HTTP ${response.status})`;
        }
        const result = {
          raw,
          payload,
          duration,
          timestamp,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok && payload !== undefined && !errorMessage,
          errorMessage
        };
        memory[kind] = result;
        updateInspector(kind, url, result);
        renderRaw(kind, raw);
        if (kind === 'search') renderSearchResult(result);
        else renderDetailResult(result);
        return result;
      } catch (error) {
        const result = {
          raw: '',
          payload: undefined,
          duration: performance.now() - started,
          timestamp,
          status: null,
          statusText: '',
          ok: false,
          errorMessage: error instanceof TypeError ? 'Unable to reach the API. Check the API base URL, network, and CORS configuration.' : error.message
        };
        memory[kind] = result;
        updateInspector(kind, url, result);
        renderRaw(kind, '');
        if (kind === 'search') renderSearchResult(result);
        else renderDetailResult(result);
        return result;
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
        button.querySelector('span').textContent = button.dataset.originalLabel;
      }
    }

    function setSearchLoading(isLoading) {
      document.querySelector('#search-empty').hidden = true;
      document.querySelector('#search-table-wrap').hidden = true;
      document.querySelector('#pagination-bar').hidden = true;
      document.querySelector('#search-skeleton').hidden = !isLoading;
      if (isLoading) document.querySelector('#search-result-count').textContent = 'Loading…';
    }

    function createTextCell(value) {
      const cell = document.createElement('td');
      cell.textContent = valueText(value);
      if (!hasValue(value)) cell.classList.add('na-value');
      return cell;
    }

    function renderSearchResult(result) {
      document.querySelector('#search-skeleton').hidden = true;
      const count = document.querySelector('#search-result-count');
      const empty = document.querySelector('#search-empty');
      const tableWrap = document.querySelector('#search-table-wrap');
      const pagination = document.querySelector('#pagination-bar');
      const tbody = document.querySelector('#search-table-body');
      tbody.replaceChildren();

      if (!result.ok || !result.payload || !Array.isArray(result.payload.data)) {
        empty.hidden = false;
        tableWrap.hidden = true;
        pagination.hidden = true;
        count.textContent = 'Request failed';
        empty.querySelector('strong').textContent = result.errorMessage || 'Unable to load standards';
        empty.querySelector('p').textContent = 'Check the request inspector for status and error details, then try again.';
        return;
      }

      const records = result.payload.data;
      count.textContent = `${records.length} result${records.length === 1 ? '' : 's'}`;
      empty.hidden = records.length !== 0;
      tableWrap.hidden = records.length === 0;
      pagination.hidden = false;
      if (records.length === 0) {
        empty.querySelector('strong').textContent = 'No matching standards';
        empty.querySelector('p').textContent = 'Try a different query or move to another page.';
      }

      for (const record of records) {
        const row = document.createElement('tr');
        const codeCell = document.createElement('td');
        const codeButton = document.createElement('button');
        codeButton.className = 'code-link';
        codeButton.type = 'button';
        codeButton.textContent = valueText(record?.code);
        codeButton.disabled = record?.code == null;
        codeButton.addEventListener('click', () => openDetail(record.code));
        codeCell.append(codeButton);
        row.append(codeCell);
        row.append(createTextCell(record?.name));
        row.append(createTextCell(record?.englishName));
        row.append(createTextCell(record?.year));
        const statusCell = document.createElement('td');
        statusCell.append(makeStatusBadge(record?.status));
        row.append(statusCell);
        const urlCell = document.createElement('td');
        const safeDetailUrl = safeWebUrl(record?.detailUrl);
        if (safeDetailUrl) {
          const link = document.createElement('a');
          link.className = 'table-detail-link';
          link.href = safeDetailUrl;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.title = record.detailUrl;
          link.textContent = record.detailUrl;
          urlCell.append(link);
        } else {
          urlCell.textContent = 'N/A';
          urlCell.classList.add('na-value');
        }
        row.append(urlCell);
        row.append(createTextCell(record?.source));
        tbody.append(row);
      }

      const pageData = result.payload.pagination || {};
      const currentPage = Number.isInteger(pageData.currentPage) ? pageData.currentPage : Number(searchPage.value) || 1;
      const totalPages = pageData.totalPages;
      searchPage.value = String(currentPage);
      document.querySelector('#pagination-summary').textContent = `${valueText(pageData.totalResults)} total results`;
      document.querySelector('#pagination-current').textContent = `Page ${currentPage}${totalPages ? ` of ${totalPages}` : ''}`;
      document.querySelector('#previous-page').disabled = currentPage <= 1;
      document.querySelector('#next-page').disabled = Number.isInteger(totalPages) && currentPage >= totalPages;
    }

    function appendMetaField(target, item) {
      const field = document.createElement('div');
      field.className = 'meta-field';
      const label = document.createElement('span');
      label.className = 'meta-field-label';
      label.textContent = item.label || 'Attribute';
      const value = document.createElement('span');
      value.className = 'meta-field-value';
      if (hasValue(item.value)) {
        value.textContent = String(item.value);
      } else {
        value.textContent = 'Not provided by VSQI';
        value.classList.add('is-missing');
      }
      field.append(label, value);
      target.append(field);
    }

    function appendScopeEntry(target, item) {
      const block = document.createElement('div');
      block.className = 'scope-block';
      const label = document.createElement('span');
      label.className = 'scope-label';
      label.textContent = item.label || 'Scope';
      const text = document.createElement('p');
      text.className = 'scope-text';
      if (hasValue(item.value)) {
        text.textContent = String(item.value);
      } else {
        text.textContent = 'Not provided by VSQI';
        text.classList.add('is-missing');
      }
      block.append(label, text);
      target.append(block);
    }

    function appendRelationEntry(target, entry) {
      const item = document.createElement('li');
      item.className = 'relation-item';
      if (entry.url) {
        const link = document.createElement('a');
        link.className = 'relation-link';
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = entry.text || entry.code || 'Related standard';
        item.append(link);
      } else {
        const text = document.createElement('span');
        text.className = 'relation-text';
        text.textContent = entry.text || entry.code || 'Not provided by VSQI';
        if (!entry.text && !entry.code) text.classList.add('is-missing');
        item.append(text);
      }
      if (entry.status) item.append(makeStatusBadge(entry.status.text, entry.status.tone));
      target.append(item);
    }

    function renderDetailResult(result) {
      document.querySelector('#detail-skeleton').hidden = true;
      const empty = document.querySelector('#detail-empty');
      const groups = document.querySelector('#detail-groups');
      groups.hidden = true;
      empty.hidden = false;
      if (!result.ok || !result.payload || !result.payload.data || typeof result.payload.data !== 'object') {
        empty.querySelector('strong').textContent = result.errorMessage || 'Unable to load standard details';
        empty.querySelector('p').textContent = result.errorMessage
          ? 'Check the request inspector for status and error details, then try again.'
          : 'The API response did not contain a detail record.';
        return;
      }

      const model = buildDetailViewModel(result.payload.data);
      document.querySelector('#detail-page-title').textContent = model.header.code || 'Standard detail';

      if (model.isEmpty) {
        empty.querySelector('strong').textContent = 'No standard information';
        empty.querySelector('p').textContent = 'The API returned an empty detail record.';
        return;
      }

      const type = document.querySelector('#detail-type');
      type.textContent = model.header.type || '';
      type.hidden = !model.header.type;

      const year = document.querySelector('#detail-year');
      year.textContent = model.header.year ? `Năm ban hành ${model.header.year}` : '';
      year.hidden = !model.header.year;

      document.querySelector('#detail-code').textContent = model.header.code || 'Standard detail';

      const titleVi = document.querySelector('#detail-title-vi');
      titleVi.textContent = model.header.titleVi || '';
      titleVi.hidden = !model.header.titleVi;

      const titleEn = document.querySelector('#detail-title-en');
      titleEn.textContent = model.header.titleEn || '';
      titleEn.hidden = !model.header.titleEn;

      const statusHost = document.querySelector('#detail-status-badge');
      statusHost.replaceChildren();
      if (model.header.status) {
        statusHost.className = `badge badge-${model.header.status.tone}`;
        statusHost.textContent = model.header.status.text;
        statusHost.hidden = false;
      } else {
        statusHost.textContent = '';
        statusHost.hidden = true;
      }

      const generalSection = document.querySelector('#detail-general-section');
      const generalGrid = document.querySelector('#detail-general-grid');
      generalGrid.replaceChildren();
      model.general.forEach(item => appendMetaField(generalGrid, item));
      generalSection.hidden = model.general.length === 0;

      const scopeSection = document.querySelector('#detail-scope-section');
      const scopeList = document.querySelector('#detail-scope-list');
      scopeList.replaceChildren();
      model.scope.forEach(item => appendScopeEntry(scopeList, item));
      scopeSection.hidden = model.scope.length === 0;

      const relatedSection = document.querySelector('#detail-related-section');
      const relatedGroups = document.querySelector('#detail-related-groups');
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
      relatedSection.hidden = model.related.length === 0;

      const historySection = document.querySelector('#detail-history-section');
      const timeline = document.querySelector('#detail-timeline');
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

        if (entry.code && entry.url) {
          const link = document.createElement('a');
          link.className = 'timeline-code';
          link.href = entry.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = entry.code;
          head.append(link);
        } else {
          const code = document.createElement('span');
          code.className = 'timeline-code';
          code.textContent = entry.code || entry.text || 'Revision';
          head.append(code);
        }
        if (entry.status) head.append(makeStatusBadge(entry.status, statusTone(entry.status)));
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
      historySection.hidden = model.history.length === 0;

      const otherSection = document.querySelector('#detail-other-section');
      const otherGrid = document.querySelector('#detail-other-grid');
      otherGrid.replaceChildren();
      model.other.forEach(item => appendMetaField(otherGrid, item));
      otherSection.hidden = model.other.length === 0;

      const source = document.querySelector('#detail-source');
      const sourceBody = document.querySelector('#detail-source-body');
      sourceBody.replaceChildren();
      if (model.source) {
        const websiteRow = document.createElement('div');
        websiteRow.className = 'source-row';
        const websiteLabel = document.createElement('span');
        websiteLabel.className = 'source-label';
        websiteLabel.textContent = 'Source website';
        const websiteValue = document.createElement('span');
        websiteValue.className = 'source-value';
        websiteValue.textContent = model.source.website || 'VSQI';
        if (model.source.host) websiteValue.textContent += ` · ${model.source.host}`;
        websiteRow.append(websiteLabel, websiteValue);

        const urlRow = document.createElement('div');
        urlRow.className = 'source-row';
        const urlLabel = document.createElement('span');
        urlLabel.className = 'source-label';
        urlLabel.textContent = 'Source URL';
        const urlValue = document.createElement('span');
        urlValue.className = 'source-value';
        if (model.source.url) {
          const link = document.createElement('a');
          link.href = model.source.url;
          link.target = '_blank';
          link.rel = 'noreferrer';
          link.textContent = model.source.url;
          urlValue.append(link);
        } else {
          urlValue.textContent = 'Not provided by VSQI';
          urlValue.classList.add('is-missing');
        }
        urlRow.append(urlLabel, urlValue);
        sourceBody.append(websiteRow, urlRow);
        source.hidden = false;
      } else {
        source.hidden = true;
      }

      empty.hidden = true;
      groups.hidden = false;
    }

    function openDetail(code) {
      detailInput.value = code;
      showView('detail');
      detailForm.requestSubmit();
    }

    async function searchStandards() {
      const query = searchInput.value.trim();
      const page = Math.max(1, Math.min(1000, Number(searchPage.value) || 1));
      searchPage.value = String(page);
      if (query.length < 2) {
        showToast('Enter at least 2 characters to search');
        searchInput.focus();
        return;
      }
      searchInput.value = query;
      setSearchLoading(true);
      try {
        getBaseUrl();
      } catch (error) {
        const result = { raw: '', payload: undefined, duration: 0, timestamp: new Date().toLocaleString(), status: null, statusText: '', ok: false, errorMessage: error.message };
        memory.search = result;
        updateInspector('search', 'Invalid API base URL', result);
        renderRaw('search', '');
        renderSearchResult(result);
        return;
      }
      const params = new URLSearchParams({ q: query, page: String(page) });
      await requestApi('search', `/api/v1/standards/search?${params}`);
    }

    async function requestDetail() {
      const code = detailInput.value.trim().replace(/\s+/g, ' ');
      if (!code) {
        showToast('Enter a standard code');
        detailInput.focus();
        return;
      }
      detailInput.value = code;
      document.querySelector('#detail-empty').hidden = true;
      document.querySelector('#detail-groups').hidden = true;
      document.querySelector('#detail-skeleton').hidden = false;
      try {
        getBaseUrl();
      } catch (error) {
        const result = { raw: '', payload: undefined, duration: 0, timestamp: new Date().toLocaleString(), status: null, statusText: '', ok: false, errorMessage: error.message };
        memory.detail = result;
        updateInspector('detail', 'Invalid API base URL', result);
        renderRaw('detail', '');
        renderDetailResult(result);
        return;
      }
      await requestApi('detail', `/api/v1/standards/${encodeURIComponent(code)}`);
    }

    searchForm.addEventListener('submit', event => {
      event.preventDefault();
      void searchStandards();
    });
    detailForm.addEventListener('submit', event => {
      event.preventDefault();
      void requestDetail();
    });

    apiBaseInput.addEventListener('change', () => {
      try {
        const base = getBaseUrl();
        apiBaseInput.value = base;
        try {
          localStorage.setItem('vsqi-api-base-url', base);
        } catch {
          showToast('API base URL updated for this session');
          return;
        }
        showToast('API base URL saved');
      } catch (error) {
        showToast(error.message);
      }
    });
    apiBaseInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        apiBaseInput.dispatchEvent(new Event('change'));
      }
    });

    document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('is-open'));
    document.querySelectorAll('[data-query]').forEach(button => button.addEventListener('click', () => {
      searchInput.value = button.dataset.query;
      searchPage.value = '1';
      searchForm.requestSubmit();
    }));
    document.querySelector('#previous-page').addEventListener('click', () => {
      searchPage.value = String(Math.max(1, Number(searchPage.value) - 1));
      searchForm.requestSubmit();
    });
    document.querySelector('#next-page').addEventListener('click', () => {
      searchPage.value = String(Math.min(1000, Number(searchPage.value) + 1));
      searchForm.requestSubmit();
    });

    document.querySelectorAll('[data-response-tab]').forEach(button => button.addEventListener('click', () => {
      const group = button.closest('.results-card, .detail-response-card');
      group.querySelectorAll('[data-response-tab]').forEach(tab => tab.classList.toggle('is-active', tab === button));
      group.querySelectorAll('.response-pane').forEach(pane => {
        const active = pane.id === `${button.dataset.responseTab}-pane`;
        pane.hidden = !active;
        pane.classList.toggle('is-active', active);
      });
    }));
    document.querySelectorAll('.copy-url').forEach(button => button.addEventListener('click', async () => {
      const url = document.querySelector(`#${button.dataset.copyUrl}-request-url`).textContent;
      if (!url || url === '—') return showToast('No request URL to copy');
      try {
        await navigator.clipboard.writeText(url);
        showToast('Request URL copied');
      } catch {
        showToast('Clipboard access is unavailable in this browser');
      }
    }));
    document.querySelectorAll('.copy-json').forEach(button => button.addEventListener('click', async () => {
      const result = memory[button.dataset.raw];
      if (!result) return showToast('No response JSON to copy');
      try {
        await navigator.clipboard.writeText(result.raw);
        showToast('Raw response copied');
      } catch {
        showToast('Clipboard access is unavailable in this browser');
      }
    }));
    document.querySelectorAll('[data-doc-action]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.docAction;
      showView(action);
      if (action === 'search') searchInput.focus();
      else detailInput.focus();
    }));
  }

  initApp();
})();
