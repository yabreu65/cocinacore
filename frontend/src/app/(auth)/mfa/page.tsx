'use client';

import Link from 'next/link';

export default function MfaPage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-10 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow">
        <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">
          COCINACORE • SEGURIDAD
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Verificación en dos pasos</h1>
        <p className="mt-2 text-sm text-bistro-text-secondary">
          Funcionalidad en reconstrucción durante la migración.
        </p>

        <div className="mt-5 rounded-2xl border border-bistro-border bg-white/80 p-4 text-sm text-bistro-text-secondary">
          El flujo MFA temporalmente no está disponible en frontend. Usá el acceso principal o
          contacta soporte si necesitás entrar con urgencia.
        </div>

        <div className="mt-5 flex gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-4 font-semibold text-white"
          >
            Volver al login
          </Link>
          <Link
            href="/app"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-bistro-border px-4 font-semibold text-bistro-text-secondary"
          >
            Ir al panel
          </Link>
        </div>
      </section>
    </main>
  );
}
