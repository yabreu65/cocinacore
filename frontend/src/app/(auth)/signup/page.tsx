'use client';

import Link from 'next/link';
import { type FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthBenefitsPanel } from '../AuthBenefitsPanel';
import { mapAuthError } from '@/lib/auth/errors';

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const passwordStrengthHint = useMemo(
    () => 'Usá 8+ caracteres, incluyendo mayúsculas, minúsculas y número.',
    []
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get('fullName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');
    const acceptedTerms = formData.get('termsAccepted') === 'on';

    if (fullName.length < 3) {
      setErrorMessage('Ingresá tu nombre completo.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password,
          confirmPassword,
          termsAccepted: acceptedTerms,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;

      if (!response.ok || body?.ok !== true) {
        setErrorMessage(body?.error ?? mapAuthError(null, 'signup'));
        return;
      }

      // Signup creates an authenticated session and sets its cookie on the response.
      // Preserve the form reference before the asynchronous request: React clears
      // event.currentTarget when the event handler yields.
      form.reset();
      setTermsAccepted(false);
      setSuccessMessage('Cuenta creada. Abriendo tu cocina...');
      router.replace('/app');
    } catch (error) {
      setSuccessMessage(null);
      setErrorMessage(mapAuthError(error, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setOauthLoading(provider);

    if (!termsAccepted) {
      setErrorMessage('Debés aceptar términos y privacidad.');
      setOauthLoading(null);
      return;
    }

    await Promise.resolve();
    setErrorMessage('Funcionalidad en reconstrucción. Creá la cuenta con email por ahora.');
    setOauthLoading(null);
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-5 text-bistro-text-primary sm:px-6 sm:py-8">
      <div className="mx-auto grid w-full max-w-[1120px] overflow-hidden rounded-3xl border border-bistro-border bg-white shadow-sm lg:min-h-[690px] lg:grid-cols-[0.88fr_1.12fr]">
        <AuthBenefitsPanel mode="signup" />

        <section className="flex min-w-0 items-center justify-center p-4 sm:p-6 lg:p-9">
          <div className="w-full max-w-lg rounded-2xl bg-white px-1 py-3 sm:px-5 sm:py-6">
            <p className="mb-4 inline-flex items-center gap-2 rounded-xl bg-bistro-inverse px-3 py-2 text-xs font-bold tracking-[0.1em] text-bistro-champagne lg:hidden">
              COCINACORE • TU HOGAR
            </p>
            <h1 className="font-bistro-heading text-3xl font-semibold leading-tight text-bistro-text-primary sm:text-4xl">
              Crear cuenta
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
              Empieza gratis y organiza tu cocina con asistencia inteligente.
            </p>

            <form onSubmit={onSubmit} className="mt-5 grid gap-3.5" noValidate>
              <div className="grid gap-2">
                <label
                  htmlFor="signup-name"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Nombre completo
                </label>
                <input
                  id="signup-name"
                  name="fullName"
                  autoComplete="name"
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="signup-email"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Correo
                </label>
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="signup-password"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Contraseña
                </label>
                <input
                  id="signup-password"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="signup-confirm-password"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Confirmar contraseña
                </label>
                <input
                  id="signup-confirm-password"
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>

              <p className="text-xs text-bistro-text-secondary">{passwordStrengthHint}</p>

              <label className="flex items-start gap-3 text-sm text-bistro-text-secondary">
                <input
                  name="termsAccepted"
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-bistro-border accent-bistro-action-primary"
                />
                Acepto términos y privacidad
              </label>

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
                {loading ? 'Creando cuenta...' : 'Crear cuenta gratis'}
              </button>
            </form>

            <details className="mt-5 rounded-xl border border-bistro-border bg-bistro-page px-3 py-2">
              <summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-bistro-action-primary">
                Google y GitHub (en preparación)
              </summary>
              <div className="border-t border-bistro-border pb-2 pt-1">
                <p className="mb-3 text-xs leading-relaxed text-bistro-text-secondary">
                  El registro social todavía no está disponible. Usá el formulario para crear tu
                  cuenta.
                </p>
                <div className="my-5 flex items-center gap-3">
                  <div className="h-px flex-1 bg-bistro-border" />
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bistro-text-secondary">
                    o continuar con
                  </span>
                  <div className="h-px flex-1 bg-bistro-border" />
                </div>

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
                </div>
              </div>
            </details>

            <p className="mt-5 text-center text-sm text-bistro-text-secondary">
              ¿Ya tienes cuenta?{' '}
              <Link
                href="/login"
                className="font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
