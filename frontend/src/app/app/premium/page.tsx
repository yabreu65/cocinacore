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
      <section className="mx-auto w-full max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-bold tracking-[0.15em] text-bistro-champagne">
              COCINACORE • PREMIUM
            </p>
            <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
              CocinaCore Premium
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-bistro-cream">
              Esta experiencia está en reconstrucción. Las recomendaciones Premium todavía no están
              disponibles.
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex min-h-11 items-center rounded-xl border border-white/40 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
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
          Estas funciones aún no están activas. Mientras tanto, podés seguir usando el asistente de
          recetas y Mi recetario.
        </div>
      </section>
    </main>
  );
}
