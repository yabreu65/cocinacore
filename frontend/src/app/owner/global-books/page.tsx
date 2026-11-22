import { BookOpenText, Globe2, Tag, Library } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

export const dynamic = 'force-dynamic';

type GlobalBookRow = {
  id: string;
  title: string;
  author: string | null;
  cuisine_region: string;
  cuisine_country: string | null;
  cuisine_style: string | null;
  tags: string[];
};

export default async function OwnerGlobalBooksPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  if (!(await isPlatformOwner(user))) {
    redirect('/app');
  }

  const result = await query<GlobalBookRow>(
    `select id, title, author, cuisine_region, cuisine_country, cuisine_style, tags
     from public.global_books
     order by created_at desc
     limit 24`
  );

  const rows = result.rows;
  const regions = Array.from(new Set(rows.map((row) => row.cuisine_region))).sort();
  const allTags = Array.from(new Set(rows.flatMap((row) => row.tags ?? []))).sort();

  return (
    <section className="space-y-5">
      <header className="grid gap-5 rounded-[26px] bg-bistro-inverse px-6 py-7 text-white shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-8">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-bistro-champagne">
            <BookOpenText size={16} aria-hidden="true" /> Colección compartida
          </p>
          <h2 className="mt-3 font-bistro-heading text-3xl font-semibold sm:text-4xl">
            Biblioteca global
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-bistro-cream">
            Consultá libros de cocina, sus autores y la clasificación culinaria disponible.
          </p>
        </div>
        <div
          className="hidden size-20 items-center justify-center rounded-3xl bg-white/10 text-bistro-champagne sm:flex"
          aria-hidden="true"
        >
          <Library size={38} />
        </div>
      </header>

      <section
        aria-label="Resumen de biblioteca"
        className="grid grid-cols-3 divide-x divide-bistro-border rounded-2xl border border-bistro-border bg-white py-4 shadow-sm"
      >
        {[
          { label: 'Libros', value: rows.length },
          { label: 'Regiones', value: regions.length },
          { label: 'Etiquetas', value: allTags.length },
        ].map((item) => (
          <div key={item.label} className="min-w-0 px-3 text-center sm:px-5">
            <p className="font-bistro-heading text-2xl font-semibold text-bistro-text-primary sm:text-3xl">
              {item.value}
            </p>
            <p className="mt-1 text-[11px] font-medium text-bistro-text-secondary sm:text-xs">
              {item.label}
            </p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="owner-books-list"
        className="overflow-hidden rounded-[24px] border border-bistro-border bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bistro-border p-5">
          <div>
            <h3 id="owner-books-list" className="font-bistro-heading text-xl font-semibold">
              Libros registrados
            </h3>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Últimos 24 registros como máximo
            </p>
          </div>
          <span className="rounded-full bg-bistro-page px-3 py-1 text-xs font-semibold text-bistro-action-secondary">
            {rows.length} visibles
          </span>
        </div>
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-bistro-border bg-bistro-page/70 px-6 py-3 text-xs font-bold uppercase tracking-wider text-bistro-text-secondary md:grid">
          <span>Libro</span>
          <span>Origen y estilo</span>
          <span>Etiquetas</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <BookOpenText
              size={32}
              className="mx-auto text-bistro-action-secondary"
              aria-hidden="true"
            />
            <p className="mt-4 font-semibold">Todavía no hay libros en la biblioteca global.</p>
            <p className="mt-2 text-sm text-bistro-text-secondary">
              Los libros aparecerán aquí cuando estén disponibles.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-bistro-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid min-w-0 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4 md:px-6"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bistro-page text-bistro-action-secondary"
                    aria-hidden="true"
                  >
                    <BookOpenText size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-bistro-text-primary">{row.title}</p>
                    <p className="mt-1 text-xs text-bistro-text-secondary">
                      Autor: {row.author ?? 'No especificado'}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-bistro-text-secondary">
                  <p className="flex items-center gap-1.5">
                    <Globe2 size={13} aria-hidden="true" /> {row.cuisine_region} ·{' '}
                    {row.cuisine_country ?? 'País no definido'}
                  </p>
                  <p className="mt-1.5">Estilo: {row.cuisine_style ?? 'General'}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(row.tags ?? []).length ? (
                    row.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-lg bg-bistro-page px-2.5 py-1.5 text-xs text-bistro-text-secondary"
                      >
                        <Tag size={12} aria-hidden="true" />
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-bistro-text-secondary">Sin etiquetas</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
