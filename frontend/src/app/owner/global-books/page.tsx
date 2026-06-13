import { BookOpenText, Globe2, Tag } from 'lucide-react';
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

  if (!(await isPlatformOwner(user.id))) {
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
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
          <BookOpenText size={14} /> Biblioteca global curada
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Global Books</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Vista mínima con datos reales desde PostgreSQL directo.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">Libros</p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{rows.length}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">Regiones</p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{regions.length}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">Tags</p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{allTags.length}</p>
          </div>
        </div>
      </article>

      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-4 premium-shadow">
            <p className="line-clamp-2 text-base font-semibold text-[#241A14]">{row.title}</p>
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-[#6B5A50]">
              <Globe2 size={12} /> {row.cuisine_region} · {row.cuisine_country ?? 'País no definido'}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">Estilo: {row.cuisine_style ?? 'General'}</p>
            <p className="mt-1 text-xs text-[#6B5A50]">Autor: {row.author ?? 'No especificado'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(row.tags ?? []).length > 0 ? (
                row.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1 text-[11px] text-[#6B5A50]"
                  >
                    <Tag size={10} /> {tag}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1 text-[11px] text-[#6B5A50]">
                  Sin tags
                </span>
              )}
            </div>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay libros globales cargados.</li> : null}
      </ul>
    </section>
  );
}
