import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), save: vi.fn(), remove: vi.fn(), transaction: vi.fn(), query: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/storage/tenantPdfStorage', () => ({ saveTenantPdf: mocks.save, deleteTenantPdf: mocks.remove }));
vi.mock('@/lib/private-pdf/config', () => ({ privatePdfStorageConfigured: mocks.config }));
vi.mock('@/lib/db', () => ({ scopedTransaction: mocks.transaction }));
const { POST } = await import('./route');
const tenantId = '11111111-1111-4111-8111-111111111111';
function request(options: { content?: string; chunks?: unknown; tenantId?: string } = {}) {
  const form = new FormData();
  form.set('file', new File([options.content ?? '%PDF-1.7'], 'book.pdf', { type: 'application/pdf' }));
  form.set('title', 'Book'); form.set('pageCount', '1');
  form.set('chunks', JSON.stringify(options.chunks ?? [{ content: 'Text', pageNumber: 1, embedding: Array(1536).fill(0.1) }]));
  if (options.tenantId) form.set('tenantId', options.tenantId);
  return new NextRequest('http://localhost/api/library/private-pdfs', { method: 'POST', body: form });
}
describe('private PDF upload', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ id: 'user', tenant: { tenantId, tenantType: 'home' } });
    mocks.rate.mockResolvedValue({ success: true, storage: 'redis' }); mocks.config.mockReturnValue(true);
    mocks.save.mockResolvedValue({ storagePath: 'private-path' }); mocks.remove.mockResolvedValue(undefined);
    mocks.transaction.mockImplementation(async (_scope: unknown, callback: (client: { query: typeof mocks.query }) => Promise<unknown>) => callback({ query: mocks.query }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('count(*)')) return { rows: [{ count: '0' }] };
      if (sql.includes('SELECT 1')) return { rows: [] };
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'new-id' }] };
      return { rows: [] };
    });
  });
  it('rejects anonymous without reading the body', async () => {
    mocks.auth.mockRejectedValue(new Error()); const req = request();
    expect((await POST(req)).status).toBe(401); expect(req.bodyUsed).toBe(false);
  });
  it('requires a tenant', async () => { mocks.auth.mockResolvedValue({ id: 'user', tenant: null }); expect((await POST(request())).status).toBe(403); });
  it('rejects malformed files and invalid chunks', async () => {
    expect((await POST(request({ content: 'bad' }))).status).toBe(400);
    expect((await POST(request({ chunks: [{ content: 'x', pageNumber: 2, embedding: [] }] }))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('cleans up when quota is reached', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes('count(*)') ? { rows: [{ count: '5' }] } : { rows: [] });
    expect((await POST(request())).status).toBe(409); expect(mocks.remove).toHaveBeenCalledWith({ tenantId, storagePath: 'private-path' });
  });
  it('cleans up on duplicate and database failure', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes('count(*)') ? { rows: [{ count: '0' }] } : sql.includes('SELECT 1') ? { rows: [{}] } : { rows: [] });
    expect((await POST(request())).status).toBe(409);
    mocks.transaction.mockRejectedValueOnce(new Error('database detail'));
    const response = await POST(request());
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: 'Upload failed' });
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });
  it('fails closed before consuming the body when storage is unconfigured', async () => {
    mocks.config.mockReturnValue(false); const req = request();
    expect((await POST(req)).status).toBe(503); expect(req.bodyUsed).toBe(false);
  });
  it('ignores forged tenant scope and writes chunks with scoped metadata', async () => {
    expect((await POST(request({ tenantId: 'foreign' }))).status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledWith({ tenantId, userId: 'user' }, expect.any(Function));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ tenantId }));
    const chunkCall = mocks.query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO public.book_chunks'));
    expect((chunkCall?.[1] as unknown[] | undefined)?.[3]).toEqual(JSON.stringify({ book_title: 'Book', page_number: 1 }));
  });
});
