import type { User } from '@supabase/supabase-js';
import type { GuardResult, TenantRole } from './types';
import { getSafeRedirectPath } from './safeRedirect';

const PRIVILEGED_ROLES: TenantRole[] = ['owner', 'admin'];

export function isPrivilegedRole(role: TenantRole | null | undefined): boolean {
  return role ? PRIVILEGED_ROLES.includes(role) : false;
}

export function requiresPasswordMfa(role: TenantRole | null | undefined, user: User): boolean {
  const provider = typeof user.app_metadata.provider === 'string' ? user.app_metadata.provider : null;
  return isPrivilegedRole(role) && provider === 'email';
}

export function buildLoginRedirect(requestUrl: string, pathname: string, search: string): URL {
  const loginUrl = new URL('/login', requestUrl);
  loginUrl.searchParams.set('next', getSafeRedirectPath(pathname + search));
  return loginUrl;
}

export function buildMfaRedirect(requestUrl: string, pathname: string, search: string): URL {
  const mfaUrl = new URL('/mfa', requestUrl);
  mfaUrl.searchParams.set('next', getSafeRedirectPath(pathname + search));
  return mfaUrl;
}

export function requireAuth(isAuthenticated: boolean): GuardResult {
  return isAuthenticated ? { allowed: true } : { allowed: false, reason: 'unauthenticated' };
}

export function requireRole(
  role: TenantRole | null | undefined,
  allowedRoles: readonly TenantRole[]
): GuardResult {
  return role && allowedRoles.includes(role)
    ? { allowed: true }
    : { allowed: false, reason: 'insufficient-role' };
}

export function requireMfa(required: boolean, verified: boolean): GuardResult {
  return !required || verified ? { allowed: true } : { allowed: false, reason: 'mfa-required' };
}
