import type { ReactNode } from 'react';
import Link from 'next/link';

type LegalRoute = '/privacy' | '/terms' | '/cookies';

const sections: { href: LegalRoute; label: string }[] = [
  { href: '/privacy', label: 'Privacidad' },
  { href: '/terms', label: 'Términos de uso' },
  { href: '/cookies', label: 'Cookies' },
];

/** Visual-only layout; legal clauses are owned and reviewed separately. */
export default function PublicLegalShell({
  current,
  title,
  children,
}: {
  current: LegalRoute;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page text-bistro-text-primary">
      <header className="bg-bistro-inverse px-4 pb-10 pt-5 text-white sm:px-6 sm:pb-12 sm:pt-7">
        <div className="mx-auto max-w-4xl">
          <nav aria-label="Acceso al sitio" className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="font-bistro-heading text-xl font-semibold text-bistro-champagne hover:text-white"
            >
              CocinaCore Bistró
            </Link>
            <Link
              href="/login"
              className="rounded-xl border border-white/30 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Iniciar sesión
            </Link>
          </nav>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.15em] text-bistro-champagne">
            Información legal
          </p>
          <h1 className="mt-3 max-w-3xl font-bistro-heading text-3xl font-semibold leading-tight sm:text-5xl">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-bistro-cream">
            Consultá aquí el documento publicado por CocinaCore.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 pb-14 sm:px-6">
        <nav
          aria-label="Documentos legales"
          className="-mt-5 relative z-10 flex flex-wrap gap-2 rounded-2xl border border-bistro-border bg-white p-2 shadow-sm"
        >
          {sections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={current === section.href ? 'page' : undefined}
              className={
                current === section.href
                  ? 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-bistro-action-primary px-3 py-2 text-center text-xs font-semibold text-white sm:text-sm'
                  : 'inline-flex min-h-11 flex-1 items-center justify-center rounded-xl px-3 py-2 text-center text-xs font-semibold text-bistro-text-primary hover:bg-bistro-surface-warm sm:text-sm'
              }
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <article className="mt-5 rounded-2xl border border-bistro-border bg-white p-5 shadow-sm sm:p-8">
          <p className="mb-7 rounded-xl border border-bistro-border bg-bistro-surface-warm px-3 py-3 text-xs leading-relaxed text-bistro-text-secondary">
            Versión en español del documento existente. Su contenido debe revisarse legalmente
            antes de considerarlo definitivo.
          </p>
          <div className="space-y-7">{children}</div>
        </article>

        <div className="mt-7 text-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-bistro-border bg-white px-5 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-surface-warm"
          >
            Volver a CocinaCore
          </Link>
        </div>
      </div>
    </main>
  );
}
