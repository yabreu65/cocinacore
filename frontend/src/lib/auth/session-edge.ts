import { jwtVerify } from 'jose';

export interface VerifiedTokenPayload {
  userId: string;
  email: string;
  fullName: string | null;
  tenantId: string | null;
  role: 'owner' | 'admin' | 'member';
  tenantType: 'home' | 'professional';
  onboardingCompleted: boolean;
}

export function getSessionCookieName(): string {
  return process.env.AUTH_COOKIE_NAME?.trim() || 'cocinacore_session';
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.trim() === '' || secret === 'CHANGE_ME') {
    throw new Error('AUTH_SECRET environment variable is required and must be changed.');
  }
  return new TextEncoder().encode(secret);
}

function isTenantRole(value: unknown): value is 'owner' | 'admin' | 'member' {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function isTenantType(value: unknown): value is 'home' | 'professional' {
  return value === 'home' || value === 'professional';
}

export async function verifySessionToken(
  token: string
): Promise<VerifiedTokenPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    const userId = payload.sub;
    const exp = payload.exp;
    const email = payload.email;
    if (!userId || !exp || typeof email !== 'string') return null;

    const role = payload.role;
    const tenantType = payload.tenantType;
    if (!isTenantRole(role) || !isTenantType(tenantType)) return null;

    return {
      userId,
      email,
      fullName: typeof payload.fullName === 'string' ? payload.fullName : null,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      role,
      tenantType,
      onboardingCompleted: payload.onboardingCompleted === true,
    };
  } catch {
    return null;
  }
}
