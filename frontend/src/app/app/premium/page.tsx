import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

const placeholderCards = [
  {
    title: 'Recetas destacadas de comunidad',
    description: 'Estamos reconstruyendo el ranking premium sobre PostgreSQL directo.',
  },
  {
    title: 'Señales de inventario',
    description: 'La correlación entre inventario y premium vuelve en la siguiente fase.',
  },
  {
    title: 'Guardados y feedback',
    description: 'Likes, dislikes y guardados están temporalmente en modo placeholder.',
  },
];

export default async function PremiumBoardIntelligentPage() {
  const user = await getCurrentUser();

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-6xl rounded-3xl border border-[#E8DDD2] bg-white/85 p-5 premium-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">COCINACORE • PREMIUM</p>
            <h1 className="mt-2 text-3xl font-semibold">Premium Board</h1>
            <p className="mt-2 max-w-2xl text-sm text-[#6B5A50]">
              Funcionalidad en reconstrucción durante la migración. La página ya renderiza estable
              y con TypeScript estricto.
            </p>
          </div>
          <Link href="/app" className="rounded-xl bg-[#C56A1A] px-4 py-2 text-sm font-semibold text-white">
            Volver al panel
          </Link>
        </div>

        <div className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4 text-sm text-[#6B5A50]">
          {user ? `Sesión activa: ${user.fullName ?? user.email}` : 'Iniciá sesión para recuperar la experiencia premium cuando termine la migración.'}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {placeholderCards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-[#E8DDD2] bg-white/75 p-4">
              <h2 className="text-lg font-semibold text-[#241A14]">{card.title}</h2>
              <p className="mt-2 text-sm text-[#6B5A50]">{card.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-[#C56A1A]/40 bg-[#FFF8F1] p-4 text-sm text-[#6B5A50]">
          Próximo entregable: volver a conectar feed, recomendaciones y acciones sociales a rutas/API directas.
        </div>
      </section>
    </main>
  );
}
