import { type NextRequest, NextResponse } from 'next/server';
import { buildLoginRedirect, isPrivilegedRole } from '@/lib/auth/guards';
import type { TenantRole } from '@/lib/auth/types';
import { getSessionFromRequest } from '@/lib/auth/session';

interface UserProfileForGuard {
  role: TenantRole;
  tenantId: string | null;
}

// ---------------------------------------------------------------------------
// Route classification
// ---------------------------------------------------------------------------

/** Path prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = [
  '/app',
  '/owner',
  '/members',
  '/billing',
  '/dashboard',
  '/library',
  '/meal-planner',
  '/premium',
  '/profile',
  '/recipes',
];

/** Paths that are always accessible regardless of auth state. */
const PUBLIC_PATHS = new Set(['/', '/login', '/signup', '/invite', '/mfa']);

/** Public path prefixes — any path starting with one of these is allowed. */
const PUBLIC_PREFIXES = ['/api/health', '/_next', '/favicon', '/api/auth'];

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isOwnerRoute(pathname: string): boolean {
  return pathname === '/owner' || pathname.startsWith('/owner/') || pathname.startsWith('/api/owner/');
}

function isTenantPrivilegedRoute(pathname: string): boolean {
  return pathname === '/members' || pathname.startsWith('/members/');
}

function isTenantRole(value: unknown): value is TenantRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function toUserProfileForGuard(user: { role: string; tenantId: string | null }): UserProfileForGuard | null {
  if (!isTenantRole(user.role)) return null;
  return {
    role: user.role,
    tenantId: user.tenantId,
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Public paths — allow through without auth check
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Only check auth for protected routes AND api routes
  // Everything else (marketing pages, static files, etc.) passes through
  if (!isProtectedRoute(pathname) && !isApiRoute(pathname)) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(request);
  const user = session?.user ?? null;

  // No authenticated user → deny access
  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.redirect(buildLoginRedirect(request.url, pathname, search));
  }

  if (isOwnerRoute(pathname) || isTenantPrivilegedRoute(pathname)) {
    const profile = toUserProfileForGuard({
      role: user.tenant?.role ?? 'member',
      tenantId: user.tenant?.tenantId ?? null,
    });

    let authorized = false;
    if (isOwnerRoute(pathname)) {
      authorized = user.tenant?.role === 'owner' || false;
    } else {
      authorized = Boolean(profile?.tenantId && isPrivilegedRole(profile.role));
    }

    if (!authorized) {
      if (isApiRoute(pathname)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/app', request.url));
    }
  }

  return NextResponse.next({ request });
}

// ---------------------------------------------------------------------------
// Matcher — limits which paths the middleware runs on
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
