import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  isOwner: vi.fn(),
  upload: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db/repositories/platformOwnerRepository', () => ({
  isPlatformOwner: mocks.isOwner,
}));
vi.mock('@/lib/owner/global-writer', () => ({ createGlobalUpload: mocks.upload }));
vi.mock('@/lib/storage', () => ({
  getStorageAdapter: () => ({ saveFile: mocks.save, deleteFile: mocks.remove }),
}));
import { POST } from './route';

function request() {
  const form = new FormData();
  form.set('file', new File(['pdf'], 'book.pdf', { type: 'application/pdf' }));
  form.set('title', 'Book');
  form.set('chunks', JSON.stringify([{ content: 'test', pageNumber: 1, embedding: [1] }]));
  form.set('uploadedBy', 'attacker');
  return new NextRequest('http://localhost/api/owner/global-pdfs', { method: 'POST', body: form });
}
function requestWithInvalidFile() {
  const form = new FormData();
  form.set('file', new File(['not a pdf'], 'book.txt', { type: 'text/plain' }));
  form.set('title', 'Book');
  form.set('chunks', JSON.stringify([{ content: 'test', pageNumber: 1, embedding: [1] }]));
  return new NextRequest('http://localhost/api/owner/global-pdfs', { method: 'POST', body: form });
}
describe('owner global PDF upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: 'session-owner' });
    mocks.isOwner.mockResolvedValue(true);
    mocks.save.mockResolvedValue({ storagePath: 'global/file.pdf' });
    mocks.upload.mockResolvedValue('book-id');
    mocks.remove.mockResolvedValue(undefined);
  });
  it('rejects nonowners before storage or SQL', async () => {
    mocks.isOwner.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('uses authenticated uploader and preserves response', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, bookId: 'book-id', chunkCount: 1 });
    expect(mocks.isOwner).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-owner' }));
    expect(
      (mocks.upload.mock.calls[0]?.[0] as { pdf: { uploadedBy: string } }).pdf.uploadedBy
    ).toBe('session-owner');
  });
  it('validates upload data before storing a file or invoking SQL', async () => {
    const response = await POST(requestWithInvalidFile());
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('compensates stored files on SQL failure', async () => {
    mocks.upload.mockRejectedValue(new Error('failed'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith('global/file.pdf');
  });
});
