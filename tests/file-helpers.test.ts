import { describe, expect, it } from 'vitest';
import '../public/playground.js';

interface FileHelpers {
  fileKindFromName: (filename: unknown, mimeType: unknown) => string;
  needsLoginForDoc: (doc: unknown, user: unknown) => boolean;
  formatFileSize: (bytes: unknown) => string;
  elibDownloadPath: (doc: unknown) => string | null;
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: FileHelpers }).__smartrailFileHelpers;

describe('elib file-card helpers', () => {
  it('classifies file kinds by extension and mime type', () => {
    expect(helpers.fileKindFromName('report.pdf', '')).toBe('pdf');
    expect(helpers.fileKindFromName('report', 'application/pdf')).toBe('pdf');
    expect(helpers.fileKindFromName('a.docx', '')).toBe('doc');
    expect(helpers.fileKindFromName('a.xlsx', '')).toBe('xls');
    expect(helpers.fileKindFromName('a.pptx', '')).toBe('ppt');
    expect(helpers.fileKindFromName('a.png', '')).toBe('img');
    expect(helpers.fileKindFromName('a.txt', '')).toBe('txt');
    expect(helpers.fileKindFromName('a.dwg', '')).toBe('dwg');
    expect(helpers.fileKindFromName('a.zip', '')).toBe('other');
    expect(helpers.fileKindFromName('', '')).toBe('other');
  });

  it('requires login only for anonymous users on non-public or unpublished documents', () => {
    const pub = { visibility: 'public', status: 'published' };
    const internal = { visibility: 'internal', status: 'published' };
    const draft = { visibility: 'public', status: 'draft' };
    expect(helpers.needsLoginForDoc(pub, null)).toBe(false);
    expect(helpers.needsLoginForDoc(internal, null)).toBe(true);
    expect(helpers.needsLoginForDoc(draft, null)).toBe(true);
    expect(helpers.needsLoginForDoc(internal, { email: 'a@b.c', role: 'viewer' })).toBe(false);
    expect(helpers.needsLoginForDoc(pub, { email: 'a@b.c', role: 'viewer' })).toBe(false);
  });

  it('formats file sizes', () => {
    expect(helpers.formatFileSize(512)).toBe('512 B');
    expect(helpers.formatFileSize(2048)).toBe('2.0 KB');
    expect(helpers.formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(helpers.formatFileSize(null)).toBe('—');
    expect(helpers.formatFileSize('x')).toBe('—');
  });

  it('builds download paths only when a file exists', () => {
    expect(helpers.elibDownloadPath({ id: 'd1', file: { id: 'f1' } })).toBe('/api/elib/documents/d1/files/f1/download');
    expect(helpers.elibDownloadPath({ id: 'd1', file: null })).toBeNull();
    expect(helpers.elibDownloadPath(null)).toBeNull();
  });
});
