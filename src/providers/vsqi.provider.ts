import { config } from '../config.js';
import { VsqiError } from '../errors.js';
import { HttpClient } from '../http/http-client.js';
import { parseSearchHtml } from '../parsers/search.parser.js';
import { parseDetailHtml } from '../parsers/detail.parser.js';
import type { SearchInput, SearchResult, StandardDetail, StandardProvider } from '../types.js';
import type { FastifyBaseLogger } from 'fastify';

export class VsqiProvider implements StandardProvider {
  private readonly http: Pick<HttpClient, 'getHtml'>;

  constructor(http?: Pick<HttpClient, 'getHtml'>, logger?: Pick<FastifyBaseLogger, 'warn'>) {
    this.http = http ?? new HttpClient(logger);
  }

  private ensureEnabled() {
    if (config.VSQI_ENABLED.toLowerCase() !== 'true') {
      throw new VsqiError('VSQI integration is disabled', 'PROVIDER_DISABLED', 503);
    }
  }

  async search({ query, page }: SearchInput): Promise<SearchResult> {
    this.ensureEnabled();
    const url = new URL(config.VSQI_SEARCH_PATH, config.VSQI_BASE_URL);
    // Query parameter name(s) must be verified against the live VSQI form.
    // Current known form patterns have included k/si; do not silently send
    // multiple speculative parameters. Configure the verified key here.
    url.searchParams.set('k', query);
    url.searchParams.set('page', String(page));

    const html = await this.http.getHtml(url);
    return parseSearchHtml(html, page, config.VSQI_BASE_URL);
  }

  async getDetail(code: string): Promise<StandardDetail | null> {
    this.ensureEnabled();
    const search = await this.search({ query: code, page: 1 });
    const found = search.data.find(item => item.code.toLocaleLowerCase('en') === code.toLocaleLowerCase('en'));
    if (!found) return null;

    const url = new URL(config.VSQI_DETAIL_PATH, config.VSQI_BASE_URL);
    url.searchParams.set('sohieu', code);
    const detailUrl = url.toString();
    const html = await this.http.getHtml(new URL(detailUrl));
    return parseDetailHtml(html, code, detailUrl);
  }
}
