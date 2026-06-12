'use client';

import { useEffect, useState } from 'react';
import { BookOpenText, Filter, Globe2, Tag } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

type GlobalBookRow = Database['public']['Tables']['global_books']['Row'];

export default function OwnerGlobalBooksPage() {
  const [rows, setRows] = useState<GlobalBookRow[]>([]);
  const [regionFilter, setRegionFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'title' | 'region'>('recent');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: queryError } = await supabase
          .from('global_books')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(120);
        if (queryError) throw queryError;
        setRows((data ?? []) as GlobalBookRow[]);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : 'No se pudo cargar global books.'
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const regions = Array.from(new Set(rows.map((row) => row.cuisine_region).filter(Boolean))).sort();
  const normalizedSearch = search.trim().toLowerCase();
  const allTags = Array.from(new Set(rows.flatMap((row) => row.tags ?? []).filter(Boolean))).sort();
  const filteredRows = rows
    .filter((row) => {
      const regionOk = regionFilter === 'all' || row.cuisine_region === regionFilter;
      if (!regionOk) return false;
      if (tagFilter && !(row.tags ?? []).includes(tagFilter)) return false;
      if (!normalizedSearch) return true;
      return `${row.title} ${row.author ?? ''} ${row.cuisine_country ?? ''} ${row.cuisine_style ?? ''} ${(row.tags ?? []).join(' ')}`
        .toLowerCase()
        .includes(normalizedSearch);
    })
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'region') return a.cuisine_region.localeCompare(b.cuisine_region);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
          <BookOpenText size={14} /> Biblioteca global curada
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Global Books</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Catálogo global por región, país y estilo culinario (solo lectura).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">
              Libros
            </p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{rows.length}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">
              Regiones
            </p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{regions.length}</p>
          </div>
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">Tags</p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{allTags.length}</p>
          </div>
        </div>
      </article>

      <article className="rounded-3xl border border-[#E8DDD2] bg-white/85 p-5 premium-shadow">
        <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">
          <Filter size={14} /> Filtros
        </p>
        <div className="grid gap-2 md:grid-cols-3">
          <select
            value={regionFilter}
            onChange={(event) => setRegionFilter(event.target.value)}
            className="h-10 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm"
          >
            <option value="all">Todas las regiones</option>
            {regions.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por título, autor, país o tags..."
            className="h-10 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm"
          />
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as 'recent' | 'title' | 'region')}
            className="h-10 rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm"
          >
            <option value="recent">Más recientes</option>
            <option value="title">Título A-Z</option>
            <option value="region">Región A-Z</option>
          </select>
        </div>
      </article>

      {allTags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tagFilter === null ? 'border-[#C56A1A]/35 bg-[#C56A1A]/10 text-[#A55412]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
          >
            Todas las tags
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setTagFilter(tag)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tagFilter === tag ? 'border-[#C56A1A]/35 bg-[#C56A1A]/10 text-[#A55412]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {filteredRows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-4 premium-shadow"
          >
            <p className="line-clamp-2 text-base font-semibold text-[#241A14]">{row.title}</p>
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-[#6B5A50]">
              <Globe2 size={12} /> {row.cuisine_region} ·{' '}
              {row.cuisine_country ?? 'País no definido'}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">Estilo: {row.cuisine_style ?? 'General'}</p>
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
        {!loading && filteredRows.length === 0 ? (
          <li className="text-sm text-[#6B5A50]">No hay resultados para el filtro actual.</li>
        ) : null}
      </ul>
      {loading ? <p className="text-sm text-[#6B5A50]">Cargando global books...</p> : null}
    </section>
  );
}
