'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, type FormEvent, useState } from 'react';
import { ResetPasswordSchema } from '@/lib/auth/schemas';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    token ? null : 'El enlace no es válido o expiró. Pedí uno nuevo.'
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(form);
    const parsed = ResetPasswordSchema.safeParse({
      token,
      password: formData.get('password'),
      confirmPassword: formData.get('confirmPassword'),
    });

    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Revisá los datos ingresados.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/password-reset/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorMessage(body?.error ?? 'No pudimos guardar la nueva contraseña.');
        return;
      }

      form.reset();
      setSuccessMessage('Contraseña actualizada. Ya podés iniciar sesión.');
    } catch {
      setErrorMessage('No pudimos conectar con autenticación. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper flex min-h-screen items-center justify-center bg-bistro-page px-4 py-6 text-bistro-text-primary sm:px-6">
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-bistro-border bg-white shadow-sm">
        <header className="bg-bistro-inverse px-5 py-5 text-white sm:px-7 sm:py-7">
          <p className="text-xs font-bold tracking-[0.15em] text-bistro-champagne">
            COCINACORE · SEGURIDAD
          </p>
          <h1 className="mt-3 font-bistro-heading text-3xl font-semibold text-white sm:text-4xl">
            Nueva contraseña
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
            Elegí una contraseña nueva para recuperar el acceso a tu cuenta.
          </p>
        </header>
        <div className="p-5 sm:p-7">
          <p className="mb-4 text-xs leading-relaxed text-bistro-text-secondary">
            Usá al menos 8 caracteres. No compartas tu enlace de recuperación.
          </p>
          <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
            <label className="grid gap-2 text-sm font-semibold text-bistro-text-primary">
              Contraseña
              <input
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={8}
                required
                disabled={!token || Boolean(successMessage)}
                className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary disabled:opacity-60"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-bistro-text-primary">
              Confirmar contraseña
              <input
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={8}
                required
                disabled={!token || Boolean(successMessage)}
                className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary disabled:opacity-60"
              />
            </label>

            {errorMessage ? (
              <p
                role="alert"
                className="rounded-xl bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger"
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
              disabled={loading || !token || Boolean(successMessage)}
              className="min-h-12 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white transition hover:bg-bistro-action-primary-hover disabled:opacity-70"
            >
              {loading ? 'Procesando...' : 'Guardar contraseña'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-bistro-text-secondary">
            <Link
              href="/login"
              className="font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
            >
              Volver a iniciar sesión
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="texture-paper flex min-h-screen items-center justify-center bg-bistro-page px-4 py-8">
          <section className="w-full max-w-md rounded-3xl border border-bistro-border bg-white/75 p-6 text-bistro-text-primary shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
            Cargando recuperación...
          </section>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
