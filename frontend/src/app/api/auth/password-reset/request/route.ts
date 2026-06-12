import { type NextRequest, NextResponse } from 'next/server';
import { AuthEmailSchema } from '@/lib/auth/schemas';
import { checkRateLimit } from '@/lib/rate-limit';

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

async function hashIdentity(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = AuthEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ingresá un correo válido.' }, { status: 400 });
  }

  const emailHash = await hashIdentity(parsed.data.email);
  const rateLimit = await checkRateLimit('auth/password-reset', getIp(request), emailHash);
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  return NextResponse.json({ ok: true });
}
