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
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/85 p-5 premium-shadow">
        <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">
          COCINACORE • PREMIUM DETAIL
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Receta premium en reconstrucción</h1>
        <p className="mt-2 text-sm text-bistro-text-secondary">
          El detalle completo del board premium todavía no fue reconectado a PostgreSQL directo.
        </p>

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
