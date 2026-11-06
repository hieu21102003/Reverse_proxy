(() => {
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

  function valueText(value) {
    return value === null || value === undefined || value === '' ? 'N/A' : String(value);
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

  function makeStatusBadge(value) {
    const badge = document.createElement('span');
    const normalized = String(value ?? '').toLowerCase();
    badge.className = `badge ${normalized === 'active' ? 'badge-active' : normalized === 'withdrawn' ? 'badge-withdrawn' : 'badge-other'}`;
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
    if (value === null || value === undefined || value === '') cell.classList.add('na-value');
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

  function appendReplacementValue(container, value) {
    if (value === null || value === undefined || value === '') {
      container.textContent = 'Not provided by VSQI';
      container.classList.add('is-missing');
      return;
    }
    const codePattern = /\b(?:TCVN|QCVN)\s+\d[\d./-]*:\d{4}(?:\/[A-Z0-9.-]+)?/gi;
    let lastIndex = 0;
    let match;
    while ((match = codePattern.exec(String(value))) !== null) {
      container.append(document.createTextNode(String(value).slice(lastIndex, match.index)));
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = match[0];
      link.addEventListener('click', event => {
        event.preventDefault();
        openDetail(match[0]);
      });
      container.append(link);
      lastIndex = match.index + match[0].length;
    }
    container.append(document.createTextNode(String(value).slice(lastIndex)));
  }

  function appendDetailField(target, label, value, options = {}) {
    const field = document.createElement('div');
    field.className = 'detail-field';
    const name = document.createElement('span');
    name.className = 'detail-field-label';
    name.textContent = label;
    const content = document.createElement('div');
    content.className = 'detail-field-value';
    if (options.replacement) {
      appendReplacementValue(content, value);
    } else if (options.url && safeWebUrl(value)) {
      const link = document.createElement('a');
      link.href = safeWebUrl(value);
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = value;
      content.append(link);
    } else {
      content.textContent = value === null || value === undefined || value === '' ? 'Not provided by VSQI' : String(value);
      if (value === null || value === undefined || value === '') content.classList.add('is-missing');
      if (options.badge && value !== null && value !== undefined) {
        content.replaceChildren(makeStatusBadge(value));
      }
    }
    field.append(name, content);
    target.append(field);
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

    const data = result.payload.data;
    document.querySelector('#detail-page-title').textContent = data.code || 'Standard detail';
    const sections = {
      'basic-fields': [['code', 'Standard code'], ['name', 'Vietnamese name'], ['englishName', 'English name'], ['year', 'Publication year'], ['status', 'Status', { badge: true }]],
      'legal-fields': [['issuedDate', 'Issued date'], ['effectiveDate', 'Effective date'], ['issuingAgency', 'Issuing agency']],
      'replacement-fields': [['replacedBy', 'Replaced by', { replacement: true }], ['replaces', 'Replaces', { replacement: true }]],
      'source-fields': [['detailUrl', 'VSQI detail page', { url: true }], ['source', 'Source']]
    };
    for (const [id, fields] of Object.entries(sections)) {
      const target = document.querySelector(`#${id}`);
      target.replaceChildren();
      for (const [key, label, options] of fields) appendDetailField(target, label, data[key], options || {});
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
})();
