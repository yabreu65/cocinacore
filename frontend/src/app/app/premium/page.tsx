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
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-6xl rounded-3xl border border-bistro-border bg-white/85 p-5 premium-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">
              COCINACORE • PREMIUM
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Premium Board</h1>
            <p className="mt-2 max-w-2xl text-sm text-bistro-text-secondary">
              Funcionalidad en reconstrucción durante la migración. La página ya renderiza estable y
              con TypeScript estricto.
            </p>
          </div>
          <Link
            href="/app"
            className="rounded-xl bg-bistro-action-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Volver al panel
          </Link>
        </div>

        <div className="mt-4 rounded-2xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
          {user
            ? `Sesión activa: ${user.fullName ?? user.email}`
            : 'Iniciá sesión para recuperar la experiencia premium cuando termine la migración.'}
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {placeholderCards.map((card) => (
            <article
              key={card.title}
              className="rounded-2xl border border-bistro-border bg-white/75 p-4"
            >
              <h2 className="text-lg font-semibold text-bistro-text-primary">{card.title}</h2>
              <p className="mt-2 text-sm text-bistro-text-secondary">{card.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-bistro-action-primary/40 bg-bistro-page p-4 text-sm text-bistro-text-secondary">
          Próximo entregable: volver a conectar feed, recomendaciones y acciones sociales a
          rutas/API directas.
        </div>
      </section>
    </main>
  );
}
