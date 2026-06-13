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
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/85 p-5 premium-shadow">
        <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">COCINACORE • PREMIUM DETAIL</p>
        <h1 className="mt-2 text-3xl font-semibold">Receta premium en reconstrucción</h1>
        <p className="mt-2 text-sm text-[#6B5A50]">
          El detalle completo del board premium todavía no fue reconectado a PostgreSQL directo.
        </p>

        <div className="mt-5 rounded-2xl border border-[#E8DDD2] bg-white/75 p-4 text-sm text-[#6B5A50]">
          <p>
            <span className="font-semibold text-[#241A14]">ID solicitado:</span> {id}
          </p>
          <p className="mt-2">
            {user
              ? `Sesión activa para ${user.fullName ?? user.email}.`
              : 'No hay sesión activa. Cuando el flujo vuelva, necesitaremos login.'}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/app/premium" className="rounded-xl bg-[#C56A1A] px-4 py-2 text-sm font-semibold text-white">
            Volver a Premium
          </Link>
          <Link href="/app" className="rounded-xl border border-[#E8DDD2] px-4 py-2 text-sm font-semibold text-[#6B5A50]">
            Ir al panel
          </Link>
        </div>
      </section>
    </main>
  );
}
