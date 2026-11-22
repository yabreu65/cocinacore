'use client';

import Link from 'next/link';

export default function MfaPage() {
  return (
    <main className="texture-paper flex min-h-screen items-center justify-center bg-bistro-page px-4 py-6 text-bistro-text-primary sm:px-6">
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-bistro-border bg-white shadow-sm">
        <header className="bg-bistro-inverse p-5 text-white sm:p-7">
          <p className="text-xs font-bold tracking-[0.15em] text-bistro-champagne">
            COCINACORE • SEGURIDAD
          </p>
          <h1 className="mt-3 font-bistro-heading text-3xl font-semibold leading-tight sm:text-4xl">
            Verificación en dos pasos
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
            Una capa adicional de seguridad para tu cuenta.
          </p>
        </header>
        <div className="p-5 sm:p-7">
          <div
            role="status"
            className="rounded-2xl border border-bistro-border bg-bistro-surface-warm p-4 text-sm leading-relaxed text-bistro-text-secondary"
          >
            <p className="font-semibold text-bistro-text-primary">
              Verificación temporalmente no disponible
            </p>
            <p className="mt-2">
              Este paso todavía está en reconstrucción. Por ahora, volvé al inicio de sesión para
              usar el método de acceso disponible.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-bistro-action-primary px-4 font-semibold text-white"
            >
              Volver al login
            </Link>
            <Link
              href="/app"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-bistro-border px-4 font-semibold text-bistro-text-secondary"
            >
              Ir al panel
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
