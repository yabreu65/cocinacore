import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), key: vi.fn(), generate: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ requireUser: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/ai/gemini-config', async (importOriginal) => ({ ...await importOriginal<object>(), getGeminiApiKey: mocks.key }));
vi.mock('@/services/gemini', async (importOriginal) => ({
  ...await importOriginal<object>(),
  GeminiEmbeddingService: class { generateEmbeddings = mocks.generate; },
}));
const { POST } = await import('./route');
const { GeminiBatchRateLimitError } = await import('@/services/gemini');
const request = (body: unknown) => new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) });
describe('private PDF embeddings', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ id: 'user', tenant: { tenantId: 'tenant' } }); mocks.key.mockReturnValue('key'); mocks.rate.mockResolvedValue({ success: true, storage: 'redis' }); mocks.generate.mockResolvedValue([Array(1536).fill(0.1)]); });
  it('rejects anonymous before parsing', async () => { mocks.auth.mockRejectedValue(new Error()); const req = request({}); expect((await POST(req)).status).toBe(401); expect(req.bodyUsed).toBe(false); });
  it('requires tenant and shared rate limit', async () => { mocks.auth.mockResolvedValueOnce({ tenant: null }); expect((await POST(request({}))).status).toBe(403); mocks.rate.mockResolvedValue({ success: false, storage: 'redis' }); expect((await POST(request({}))).status).toBe(429); });
  it('validates input and provider output', async () => { expect((await POST(request({ texts: ['x'.repeat(901)] }))).status).toBe(400); mocks.generate.mockResolvedValueOnce([[1]]); expect((await POST(request({ texts: ['x'] }))).status).toBe(502); });
  it('preserves Gemini provider quota errors for paced client retries', async () => {
    mocks.generate.mockRejectedValueOnce(new GeminiBatchRateLimitError('75'));
    const response = await POST(request({ texts: ['x'] }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('75');
    mocks.generate.mockRejectedValueOnce(new GeminiBatchRateLimitError(null));
    const missingHeaderResponse = await POST(request({ texts: ['x'] }));
    expect(missingHeaderResponse.status).toBe(429);
    expect(missingHeaderResponse.headers.get('Retry-After')).toBeNull();
  });
  it('returns embeddings using the authenticated tenant', async () => { expect((await POST(request({ texts: ['x'], tenantId: 'foreign' }))).status).toBe(200); expect(mocks.rate).toHaveBeenCalledWith('private-pdf-embeddings', 'tenant', 'user', { requireSharedStore: true }); });
});
