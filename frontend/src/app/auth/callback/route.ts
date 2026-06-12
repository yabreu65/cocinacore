import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { mapAuthError } from '@/lib/auth/errors';
import { getSafeRedirectPath } from '@/lib/auth/safeRedirect';

function getSupabaseEnv(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

function redirectWithError(request: NextRequest, message: string): NextResponse {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('error', message);
  return NextResponse.redirect(loginUrl);
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error');
  const next = getSafeRedirectPath(requestUrl.searchParams.get('next'));
  const env = getSupabaseEnv();

  if (error) {
    return redirectWithError(request, mapAuthError(error, 'oauth'));
  }

  if (!code || !env) {
    return redirectWithError(request, 'No pudimos validar el inicio de sesión.');
  }

  const response = NextResponse.redirect(new URL(next, request.url));
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      },
    },
  });

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return redirectWithError(request, mapAuthError(exchangeError, 'oauth'));
  }

  const { data: userData } = await supabase.auth.getUser();
  const termsAcceptedAt = request.cookies.get('cc_terms_accepted_at')?.value;
  if (termsAcceptedAt) {
    if (userData.user) {
      const { error: termsError } = await supabase
        .from('users')
        .update({ terms_accepted_at: termsAcceptedAt, terms_version: 'v1' })
        .eq('id', userData.user.id);
      if (termsError) {
        return redirectWithError(request, 'No pudimos registrar la aceptación de términos.');
      }
    }
    response.cookies.set('cc_terms_accepted_at', '', { path: '/', maxAge: 0 });
  } else if (next !== '/reset-password' && userData.user) {
    const { data: profile } = await supabase
      .from('users')
      .select('terms_accepted_at')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (!profile?.terms_accepted_at) {
      await supabase.auth.signOut();
      return redirectWithError(request, 'Aceptá términos y privacidad para continuar.');
    }
  }

  return response;
}
