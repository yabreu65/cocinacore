import Link from 'next/link';

// Invitation acceptance is intentionally unavailable during the migration.
// Never echo a bearer token from a route parameter into rendered page content.
export default function InvitePage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-10 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow">
        <h1 className="text-3xl font-semibold">Invitación a CocinaCore</h1>
        <p className="mt-2 text-sm text-bistro-text-secondary">
          Funcionalidad en reconstrucción mientras migramos invitaciones a PostgreSQL directo.
        </p>

        <div className="mt-4 rounded-2xl border border-bistro-border bg-white/80 p-4 text-sm text-bistro-text-secondary">
          <p className="font-semibold text-bistro-text-primary">Invitación pendiente</p>
          <p className="mt-2">
            Por seguridad, no mostramos los datos de tu enlace de invitación. Esta función todavía
            no está disponible; pedí una nueva invitación cuando se habilite.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-4 font-semibold text-white"
          >
            Ir a login
          </Link>
          <Link
            href="/members"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-bistro-border px-4 font-semibold text-bistro-text-secondary"
          >
            Ver miembros
          </Link>
        </div>
      </section>
    </main>
  );
}
