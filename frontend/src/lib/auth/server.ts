import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { getSessionFromCookies, getSessionFromRequest, resolveSessionToken } from './session';
import { AuthUser, TenantContext, TenantRole } from './types';

export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getSessionFromCookies();
  return session?.user ?? null;
}

export async function requireUser(
  request?: NextRequest,
  errorMessage = 'Unauthorized'
): Promise<AuthUser> {
  const session = request ? await getSessionFromRequest(request) : await getSessionFromCookies();
  if (!session?.user) {
    throw new Error(errorMessage);
  }
  return session.user;
}

export async function requireTenant(
  request?: NextRequest,
  errorMessage = 'Tenant context required'
): Promise<TenantContext> {
  const user = await requireUser(request, errorMessage);
  if (!user.tenant) {
    throw new Error(errorMessage);
  }
  return user.tenant;
}

export async function requireRole(
  allowedRoles: readonly TenantRole[],
  request?: NextRequest,
  errorMessage = 'Forbidden'
): Promise<AuthUser & { tenant: NonNullable<AuthUser['tenant']> }> {
  const user = await requireUser(request, errorMessage);
  if (!user.tenant || !allowedRoles.includes(user.tenant.role)) {
    throw new Error(errorMessage);
  }
  return user as AuthUser & { tenant: NonNullable<AuthUser['tenant']> };
}

export async function getCurrentSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(process.env.AUTH_COOKIE_NAME || 'cocinacore_session')?.value ?? null;
}

export async function getCurrentSession() {
  const token = await getCurrentSessionToken();
  if (!token) return null;
  return resolveSessionToken(token);
}
