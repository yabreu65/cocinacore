import { type NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/server';
import { hashPassword } from '@/lib/auth/password';
import { ResetPasswordSchema } from '@/lib/auth/schemas';
import { updatePassword } from '@/lib/db/repositories/userRepository';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function getIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = ResetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const rateLimit = await checkRateLimit('auth/password-update', getIp(request));
  if (!rateLimit.success) {
    const retryAfter = Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000));
    return NextResponse.json(
      { error: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const emailServiceConfigured = Boolean(
    process.env.RESEND_API_KEY?.trim() ||
      process.env.SMTP_HOST?.trim() ||
      process.env.EMAIL_FROM?.trim()
  );

  if (!emailServiceConfigured) {
    return NextResponse.json(
      { error: 'Password reset service is not configured yet for direct PostgreSQL mode.' },
      { status: 503 }
    );
  }

  try {
    const user = await requireUser(request, 'El enlace no es válido o expiró. Pedí uno nuevo.');
    const passwordHash = await hashPassword(parsed.data.password);
    await updatePassword(user.id, passwordHash);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'El enlace no es válido o expiró. Pedí uno nuevo.' },
      { status: 401 }
    );
  }
}
