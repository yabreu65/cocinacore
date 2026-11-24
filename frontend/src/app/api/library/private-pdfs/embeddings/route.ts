import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { getGeminiApiKey, isConfiguredEmbedding } from '@/lib/ai/gemini-config';
import { checkRateLimit } from '@/lib/rate-limit';
import { GeminiBatchRateLimitError, GeminiEmbeddingService } from '@/services/gemini';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  let user;
  try { user = await requireUser(request, 'Unauthorized'); }
  catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 403 });
  const key = getGeminiApiKey();
  if (!key) return NextResponse.json({ error: 'Embeddings unavailable' }, { status: 503 });
  const limit = await checkRateLimit('private-pdf-embeddings', user.tenant.tenantId, user.id, { requireSharedStore: true });
  if (!limit.success) return NextResponse.json({ error: 'Embeddings unavailable' }, { status: limit.storage === 'unavailable' ? 503 : 429 });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing body');
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 512 * 1024) { await reader.cancel(); throw new Error('Body too large'); }
        parts.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const texts = body && typeof body === 'object' && 'texts' in body ? body.texts : null;
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 60 || !texts.every((text) => typeof text === 'string' && text.trim().length > 0 && text.length <= 900)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    const embeddings = await new GeminiEmbeddingService(key).generateEmbeddings(texts as string[], request.signal);
    if (embeddings.length !== texts.length || !embeddings.every(isConfiguredEmbedding)) throw new Error('Invalid embeddings');
    return NextResponse.json({ embeddings });
  } catch (error) {
    if (error instanceof GeminiBatchRateLimitError) {
      const seconds = error.retryAfterSeconds;
      return NextResponse.json(
        { error: 'Embedding quota temporarily exceeded' },
        { status: 429, headers: seconds ? { 'Retry-After': String(seconds) } : {} },
      );
    }
    return NextResponse.json({ error: 'Embedding provider unavailable' }, { status: 502 });
  }
}
