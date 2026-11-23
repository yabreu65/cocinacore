import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(),
  getPage: vi.fn(),
  options: { workerSrc: '' },
}));
vi.mock('pdfjs-dist', () => ({ getDocument: pdf.getDocument, GlobalWorkerOptions: pdf.options }));

import { uploadPrivatePdf } from './private-pdf-upload';

const vector = Array.from({ length: 1536 }, () => 0.1);
const makeFile = (text = '%PDF-1.7') => new File([text], 'book.pdf', { type: 'application/pdf' });

describe('private PDF upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdf.getPage.mockResolvedValue({ getTextContent: async () => ({ items: [{ str: 'Soup\u0000 recipe' }, {}] }) });
    pdf.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: pdf.getPage }), destroy: pdf.destroy });
    pdf.destroy.mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/embeddings')
      ? Response.json({ embeddings: [vector] })
      : Response.json({ id: 'pdf', bookId: 'book' }, { status: 201 })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('extracts safe text and sends only the private endpoints and expected multipart fields', async () => {
    const progress = vi.fn();
    await uploadPrivatePdf(makeFile(), ' Cookbook ', ' Chef ', progress);
    expect(pdf.options.workerSrc).toBe('/pdf.worker.min.mjs');
    expect(pdf.destroy).toHaveBeenCalled();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/library/private-pdfs/embeddings');
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ texts: ['Soup recipe'] });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/library/private-pdfs');
    const form = fetchMock.mock.calls[1][1]?.body as FormData;
    expect([...form.keys()].sort()).toEqual(['author', 'chunks', 'file', 'pageCount', 'title']);
    expect(form.get('title')).toBe('Cookbook');
    expect(form.get('pageCount')).toBe('1');
    expect(JSON.parse(form.get('chunks') as string)).toEqual([{ content: 'Soup recipe', pageNumber: 1, embedding: vector }]);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'extract', completed: 1, total: 1 }));
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'embed', completed: 1, total: 1 }));
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'upload' }));
  });

  it('rejects invalid signatures, file types and oversized files before parsing', async () => {
    await expect(uploadPrivatePdf(makeFile('not a PDF'), 'Title', '', vi.fn())).rejects.toThrow('firma PDF');
    await expect(uploadPrivatePdf(new File(['%PDF-'], 'x', { type: 'text/plain' }), 'Title', '', vi.fn())).rejects.toThrow('10 MiB');
    await expect(uploadPrivatePdf(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'x', { type: 'application/pdf' }), 'Title', '', vi.fn())).rejects.toThrow('10 MiB');
    expect(pdf.getDocument).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('repairs surrogate pairs split at chunk boundaries before sending text', async () => {
    pdf.getPage.mockResolvedValueOnce({ getTextContent: async () => ({ items: [{ str: 'a'.repeat(899) + '😀tail' }] }) });
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ embeddings: [vector, vector] }));
    await uploadPrivatePdf(makeFile(), 'Title', '', vi.fn());
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as { texts: string[] };
    expect(request.texts).toHaveLength(2);
    expect(request.texts[0]).toContain('\ufffd');
    expect(request.texts.every((text) => !/[\ud800-\udfff]/u.test(text))).toBe(true);
  });

  it('rejects excessive pages, excessive chunks, and textless PDFs before embedding', async () => {
    pdf.getDocument.mockReturnValueOnce({ promise: Promise.resolve({ numPages: 501 }), destroy: pdf.destroy });
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('500 páginas');
    pdf.getPage.mockResolvedValueOnce({ getTextContent: async () => ({ items: [{ str: 'a'.repeat(900_000) }] }) });
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('1000 fragmentos');
    pdf.getPage.mockResolvedValueOnce({ getTextContent: async () => ({ items: [] }) });
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('texto extraíble');
    expect(fetch).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalledTimes(3);
  });

  it('never uploads an invalid vector or reports success for a server error', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ embeddings: [[0]] }));
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('inválido');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ embeddings: [vector] }))
      .mockResolvedValueOnce(Response.json({ error: 'failure' }, { status: 500 }));
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('No se pudo guardar');
  });

  it('warns that a timed-out server upload may have completed', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ embeddings: [vector] }))
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    await expect(uploadPrivatePdf(makeFile(), 'Title', '', vi.fn())).rejects.toThrow('podría haberla guardado');
  });
});
