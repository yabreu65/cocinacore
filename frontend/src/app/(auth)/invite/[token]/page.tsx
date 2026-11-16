import Link from 'next/link';

// Bistró households do not support additional account invitations.
// Never echo a bearer token from a route parameter into rendered page content.
export default function InvitePage() {
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-10 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-bistro-border bg-white/85 p-6 premium-shadow">
        <h1 className="text-3xl font-semibold">Invitación a CocinaCore</h1>
        <p className="mt-2 text-sm text-bistro-text-secondary">
          Las invitaciones de cuentas no están disponibles.
        </p>

        <div className="mt-4 rounded-2xl border border-bistro-border bg-white/80 p-4 text-sm text-bistro-text-secondary">
          <p className="font-semibold text-bistro-text-primary">Invitaciones no disponibles</p>
          <p className="mt-2">
            Por seguridad, no mostramos los datos del enlace. Si utilizas Bistró, añade a tus
            comensales desde el perfil culinario, sin cuentas adicionales.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-4 font-semibold text-white"
          >
            Ir a login
          </Link>
        </div>
      </section>
    </main>
  );
}
