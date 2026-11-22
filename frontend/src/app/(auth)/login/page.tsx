'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthBenefitsPanel } from '../AuthBenefitsPanel';
import { useRouter } from 'next/navigation';
import { mapAuthError } from '@/lib/auth/errors';
import { getSafeRedirectPath } from '@/lib/auth/safeRedirect';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [oauthTermsAccepted, setOauthTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) {
      setErrorMessage(error);
    }
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorMessage(body?.error ?? mapAuthError(null, 'login'));
        return;
      }

      setSuccessMessage('Sesión iniciada correctamente. Redirigiendo...');
      const next = getSafeRedirectPath(new URLSearchParams(window.location.search).get('next'));
      router.push(next);
      router.refresh();
    } catch (error) {
      setErrorMessage(mapAuthError(error, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setOauthLoading(provider);

    if (!oauthTermsAccepted) {
      setErrorMessage('Aceptá términos y privacidad para continuar.');
      setOauthLoading(null);
      return;
    }

    await Promise.resolve();
    setErrorMessage('Funcionalidad en reconstrucción. Usá email y contraseña por ahora.');
    setOauthLoading(null);
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-5 text-bistro-text-primary sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-[1120px] overflow-hidden rounded-3xl border border-bistro-border bg-white shadow-sm lg:min-h-[690px] lg:grid-cols-[0.88fr_1.12fr]">
        <AuthBenefitsPanel mode="login" />

        <section className="flex min-w-0 items-center justify-center p-4 sm:p-6 lg:p-9">
          <div className="w-full max-w-lg rounded-2xl bg-white px-1 py-3 sm:px-5 sm:py-6">
            <p className="mb-4 inline-flex items-center gap-2 rounded-xl bg-bistro-inverse px-3 py-2 text-xs font-bold tracking-[0.1em] text-bistro-champagne lg:hidden">
              COCINACORE • TU HOGAR
            </p>
            <h1 className="font-bistro-heading text-3xl font-semibold leading-tight text-bistro-text-primary sm:text-4xl">
              Iniciar sesión
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
              Continúa organizando tu cocina con asistencia inteligente.
            </p>

            <form onSubmit={onSubmit} className="mt-5 grid gap-3.5" noValidate>
              <div className="grid gap-2">
                <label
                  htmlFor="login-email"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>

              <div className="grid gap-2">
                <label
                  htmlFor="login-password"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    required
                    className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3 pr-24 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-bistro-text-secondary hover:text-bistro-action-primary"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 text-sm">
                <Link
                  href="/forgot-password"
                  className="font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              {errorMessage ? (
                <p
                  role="alert"
                  className="rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
                >
                  {errorMessage}
                </p>
              ) : null}
              {successMessage ? (
                <p
                  role="status"
                  className="rounded-xl bg-bistro-success/10 px-3 py-2 text-sm text-bistro-success"
                >
                  {successMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 min-h-12 rounded-xl bg-bistro-action-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-bistro-action-primary-hover disabled:opacity-70"
              >
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-bistro-text-secondary">
              ¿Primera vez en CocinaCore?{' '}
              <Link
                href="/signup"
                className="font-semibold text-bistro-action-primary hover:underline"
              >
                Crear una cuenta
              </Link>
            </p>

            <details className="mt-5 rounded-xl border border-bistro-border bg-bistro-page px-3 py-2">
              <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-bistro-action-primary">
                Google y GitHub (en preparación)
              </summary>
              <div className="border-t border-bistro-border pb-2 pt-1">
                <p className="mb-3 text-xs leading-relaxed text-bistro-text-secondary">
                  Por ahora, iniciá sesión con tu correo y contraseña.
                </p>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-bistro-border" />
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bistro-text-secondary">
                    o continuar con
                  </span>
                  <div className="h-px flex-1 bg-bistro-border" />
                </div>
                <label className="mb-3 flex items-start gap-3 text-sm text-bistro-text-secondary">
                  <input
                    type="checkbox"
                    checked={oauthTermsAccepted}
                    onChange={(event) => setOauthTermsAccepted(event.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-bistro-border accent-bistro-action-primary"
                  />
                  Acepto términos y privacidad si esta es mi primera vez con OAuth.
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void handleOAuth('google')}
                    disabled={oauthLoading !== null}
                    className="min-h-11 rounded-xl border border-bistro-border bg-white font-semibold text-bistro-text-primary transition hover:border-bistro-action-primary disabled:opacity-70"
                  >
                    {oauthLoading === 'google' ? 'Conectando...' : 'Google'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOAuth('github')}
                    disabled={oauthLoading !== null}
                    className="min-h-11 rounded-xl border border-bistro-border bg-white font-semibold text-bistro-text-primary transition hover:border-bistro-action-primary disabled:opacity-70"
                  >
                    {oauthLoading === 'github' ? 'Conectando...' : 'GitHub'}
                  </button>
                </div>{' '}
              </div>
            </details>
          </div>
        </section>
      </div>
    </main>
  );
}
