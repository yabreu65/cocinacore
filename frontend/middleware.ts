import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import {
  buildLoginRedirect,
  isPrivilegedRole,
} from '@/lib/auth/guards';
import type { TenantRole } from '@/lib/auth/types';

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

function toUserProfileForGuard(value: unknown): UserProfileForGuard | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isTenantRole(record.role)) return null;
  return {
    role: record.role,
    tenantId: typeof record.tenant_id === 'string' ? record.tenant_id : null,
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

  // Build a response we can mutate (needed for cookie sync)
  const supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // If Supabase is not configured, block protected routes
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Authentication not configured' }, { status: 401 });
    }
    return NextResponse.redirect(buildLoginRedirect(request.url, pathname, search));
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
        // Apply any security headers the Supabase client requires
        Object.entries(headers).forEach(([key, value]) => {
          supabaseResponse.headers.set(key, value);
        });
      },
    },
  });

  // IMPORTANT: no logic between createServerClient and getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No authenticated user → deny access
  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.redirect(buildLoginRedirect(request.url, pathname, search));
  }

  if (isOwnerRoute(pathname) || isTenantPrivilegedRoute(pathname)) {
    const profileResult = await supabase
      .from('users')
      .select('role, tenant_id')
      .eq('id', user.id)
      .maybeSingle();
    const profile = toUserProfileForGuard(profileResult.data);

    let authorized = false;
    if (isOwnerRoute(pathname)) {
      const ownerResult: unknown = await supabase.rpc('is_platform_owner');
      authorized =
        typeof ownerResult === 'object' &&
        ownerResult !== null &&
        'data' in ownerResult &&
        (ownerResult as { data: unknown }).data === true;
    } else {
      authorized = Boolean(profile?.tenantId && isPrivilegedRole(profile.role));
    }

    if (!authorized) {
      if (isApiRoute(pathname)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/app', request.url));
    }

    // MFA redirect enforcement is intentionally deferred until the MFA page can verify/enroll factors.
    // PR2 establishes role boundaries; PR3 activates the MFA gate once `/mfa` is functional.
  }

  return supabaseResponse;
}

// ---------------------------------------------------------------------------
// Matcher — limits which paths the middleware runs on
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, fonts, etc.)
     *
     * We still run middleware broadly so we can protect api routes,
     * but return early for public paths to keep it cheap.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
