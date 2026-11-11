'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthEmailSchema } from '@/lib/auth/schemas';

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(form);
    const parsed = AuthEmailSchema.safeParse({ email: formData.get('email') });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? 'Ingresá un correo válido.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;
      if (!response.ok) {
        setErrorMessage(body?.error ?? 'No pudimos procesar la solicitud.');
        return;
      }

      form.reset();
      setSuccessMessage(
        body?.message ?? 'Si el correo existe en CocinaCore, te enviaremos instrucciones.'
      );
    } catch {
      setErrorMessage('No pudimos conectar con autenticación. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper flex min-h-screen items-center justify-center bg-bistro-page px-4 py-8">
      <section className="w-full max-w-md rounded-3xl border border-bistro-border bg-white/75 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
        <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">COCINACORE</p>
        <h1 className="mt-3 text-3xl font-semibold text-bistro-text-primary">
          Recuperar contraseña
        </h1>
        <p className="mt-2 text-sm text-bistro-text-secondary">
          Ingresá tu correo y te enviaremos un enlace seguro para crear una nueva contraseña.
        </p>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <label className="grid gap-2 text-sm font-semibold text-bistro-text-primary">
            Correo electrónico
            <input
              type="email"
              name="email"
              required
              className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
            />
          </label>

          {errorMessage ? (
            <p className="rounded-xl bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
              {errorMessage}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rounded-xl bg-bistro-success/10 px-3 py-2 text-sm text-bistro-success">
              {successMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-xl bg-bistro-action-primary font-semibold text-white transition hover:bg-bistro-action-primary disabled:opacity-70"
          >
            {loading ? 'Enviando...' : 'Solicitar recuperación'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-bistro-text-secondary">
          <Link
            href="/login"
            className="font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
          >
            Volver al login
          </Link>
        </p>
      </section>
    </main>
  );
}
