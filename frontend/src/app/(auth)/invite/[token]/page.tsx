import Link from 'next/link';

// Bistró households do not support additional account invitations.
// A bearer token from the route parameter must never be echoed in page content.
export default function InvitePage() {
  return (
    <main className="texture-paper flex min-h-screen items-center justify-center bg-bistro-page px-4 py-6 text-bistro-text-primary sm:px-6">
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-bistro-border bg-white shadow-sm">
        <header className="bg-bistro-inverse p-5 text-white sm:p-7">
          <p className="text-xs font-bold tracking-[0.15em] text-bistro-champagne">
            COCINACORE · ACCESO
          </p>
          <h1 className="mt-3 font-bistro-heading text-3xl font-semibold sm:text-4xl">
            Invitación a CocinaCore
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
            Tu hogar se organiza desde el perfil culinario.
          </p>
        </header>

        <div className="p-5 sm:p-7">
          <div
            role="status"
            className="rounded-2xl border border-bistro-border bg-bistro-surface-warm p-4 text-sm leading-relaxed text-bistro-text-secondary"
          >
            <h2 className="font-semibold text-bistro-text-primary">Invitaciones no disponibles</h2>
            <p className="mt-2">
              Bistró no admite cuentas adicionales por invitación. Para incluir a tus comensales,
              agregalos desde el perfil culinario, sin cuentas adicionales.
            </p>
            <p className="mt-2">
              Por seguridad, no mostramos ni procesamos el contenido de este enlace.
            </p>
          </div>

          <Link
            href="/login"
            className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-bistro-action-primary px-4 text-sm font-semibold text-white transition hover:bg-bistro-action-primary-hover sm:w-auto"
          >
            Ir a iniciar sesión
          </Link>
        </div>
      </section>
    </main>
  );
}
