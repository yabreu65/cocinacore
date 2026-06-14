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
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
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

      setSuccessMessage('Contraseña actualizada. Ya podés iniciar sesión.');
      event.currentTarget.reset();
    } catch {
      setErrorMessage('No pudimos conectar con autenticación. Intentá nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper flex min-h-screen items-center justify-center bg-[#FAF6F1] px-4 py-8">
      <section className="w-full max-w-md rounded-3xl border border-[#E8DDD2] bg-white/75 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
        <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">COCINACORE</p>
        <h1 className="mt-3 text-3xl font-semibold text-[#241A14]">Nueva contraseña</h1>
        <p className="mt-2 text-sm text-[#6B5A50]">
          Elegí una contraseña nueva para recuperar el acceso a tu cuenta.
        </p>

        <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
          <label className="grid gap-2 text-sm font-semibold text-[#3A2D24]">
            Contraseña
            <input
              type="password"
              name="password"
              minLength={8}
              required
              disabled={!token || Boolean(successMessage)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A] disabled:opacity-60"
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-[#3A2D24]">
            Confirmar contraseña
            <input
              type="password"
              name="confirmPassword"
              minLength={8}
              required
              disabled={!token || Boolean(successMessage)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A] disabled:opacity-60"
            />
          </label>

          {errorMessage ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
          ) : null}
          {successMessage ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loading || !token || Boolean(successMessage)}
            className="h-11 rounded-xl bg-[#C56A1A] font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-70"
          >
            {loading ? 'Procesando...' : 'Guardar contraseña'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[#6B5A50]">
          <Link href="/login" className="font-semibold text-[#A55412] hover:text-[#C56A1A]">
            Ir al login
          </Link>
        </p>
      </section>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="texture-paper flex min-h-screen items-center justify-center bg-[#FAF6F1] px-4 py-8">
          <section className="w-full max-w-md rounded-3xl border border-[#E8DDD2] bg-white/75 p-6 text-[#241A14] shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8">
            Cargando recuperación...
          </section>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
