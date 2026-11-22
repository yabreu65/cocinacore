import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

interface PremiumRecipeDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function PremiumRecipeDetailPage({ params }: PremiumRecipeDetailPageProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-4xl">
        <header className="rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <p className="text-xs font-bold tracking-[0.15em] text-bistro-champagne">
            CocinaCore · Premium
          </p>
          <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
            Receta Premium
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
            El detalle de esta receta todavía está en reconstrucción. No se muestran ingredientes ni
            pasos que no podamos verificar.
          </p>
        </header>

        <div className="mt-5 rounded-2xl border border-bistro-border bg-white/75 p-4 text-sm text-bistro-text-secondary">
          <p>
            <span className="font-semibold text-bistro-text-primary">ID solicitado:</span> {id}
          </p>
          <p className="mt-2">
            {user
              ? `Sesión activa para ${user.fullName ?? user.email}.`
              : 'No hay sesión activa. Cuando el flujo vuelva, necesitaremos login.'}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/app/premium"
            className="rounded-xl bg-bistro-action-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Volver a Premium
          </Link>
          <Link
            href="/app"
            className="rounded-xl border border-bistro-border px-4 py-2 text-sm font-semibold text-bistro-text-secondary"
          >
            Ir al panel
          </Link>
        </div>
      </section>
    </main>
  );
}
