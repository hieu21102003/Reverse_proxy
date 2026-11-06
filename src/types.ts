export interface Standard {
  code: string;
  name: string;
  englishName?: string;
  year?: number;
  status?: string;
  detailUrl?: string;
  source: 'VSQI';
}

export interface StandardDetail {
  code: string;
  name: string | null;
  englishName: string | null;
  year: number | null;
  status: string | null;
  issuedDate: string | null;
  effectiveDate: string | null;
  issuingAgency: string | null;
  replacedBy: string | null;
  replaces: string | null;
  detailUrl: string;
  source: 'VSQI';
}

export interface SearchResult {
  data: Standard[];
  pagination: {
    currentPage: number;
    totalPages?: number;
    totalResults?: number;
  };
  source: 'VSQI';
}

export interface SearchInput {
  query: string;
  page: number;
}

export interface StandardProvider {
  search(input: SearchInput): Promise<SearchResult>;
  getDetail(code: string): Promise<StandardDetail | null>;
}
