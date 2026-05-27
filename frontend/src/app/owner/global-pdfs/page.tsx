'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FileText, Filter, Globe2, Hash, Layers3, UploadCloud } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

type GlobalPdfRow = Database['public']['Tables']['global_pdf_library']['Row'];
type GlobalBookRow = Database['public']['Tables']['global_books']['Row'];

export default function OwnerGlobalPdfsPage() {
  const [pdfRows, setPdfRows] = useState<GlobalPdfRow[]>([]);
  const [bookRows, setBookRows] = useState<GlobalBookRow[]>([]);
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
        const [{ data: pdfData, error: pdfError }, { data: booksData, error: booksError }] = await Promise.all([
          supabase.from('global_pdf_library').select('*').order('created_at', { ascending: false }).limit(120),
          supabase.from('global_books').select('*').limit(400),
        ]);
        if (pdfError) throw pdfError;
        if (booksError) throw booksError;
        setPdfRows((pdfData ?? []) as GlobalPdfRow[]);
        setBookRows((booksData ?? []) as GlobalBookRow[]);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'No se pudo cargar global PDFs.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const bookById = useMemo(() => new Map(bookRows.map((row) => [row.id, row])), [bookRows]);
  const regions = useMemo(
    () => Array.from(new Set(bookRows.map((row) => row.cuisine_region).filter(Boolean))).sort(),
    [bookRows]
  );
  const allTags = useMemo(
    () => Array.from(new Set(bookRows.flatMap((row) => row.tags ?? []).filter(Boolean))).sort(),
    [bookRows]
  );
  const normalizedSearch = search.trim().toLowerCase();
  const filteredPdfRows = pdfRows
    .filter((row) => {
      const book = bookById.get(row.global_book_id);
      const regionOk = regionFilter === 'all' || book?.cuisine_region === regionFilter;
      if (!regionOk) return false;
      if (tagFilter && !(book?.tags ?? []).includes(tagFilter)) return false;
      if (!normalizedSearch) return true;
      const text = `${book?.title ?? ''} ${book?.author ?? ''} ${book?.cuisine_country ?? ''} ${book?.cuisine_style ?? ''} ${(book?.tags ?? []).join(' ')} ${row.storage_path}`.toLowerCase();
      return text.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const bookA = bookById.get(a.global_book_id);
      const bookB = bookById.get(b.global_book_id);
      if (sortBy === 'title') return (bookA?.title ?? '').localeCompare(bookB?.title ?? '');
      if (sortBy === 'region') return (bookA?.cuisine_region ?? '').localeCompare(bookB?.cuisine_region ?? '');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
              <FileText size={14} /> Repositorio global indexable
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Global PDFs</h2>
            <p className="mt-1 text-sm text-[#6B5A50]">PDFs globales listos para RAG y búsqueda contextual de toda la plataforma.</p>
          </div>
          <Link
            href="/owner/global-pdfs/upload"
            className="inline-flex items-center gap-2 rounded-xl bg-[#C56A1A] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#A55412]"
          >
            <UploadCloud size={14} /> Subir PDF global
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#6B5A50]">PDFs</p>
            <p className="mt-1 text-2xl font-semibold text-[#241A14]">{pdfRows.length}</p>
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
            placeholder="Buscar por libro, país, tags o archivo..."
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

      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {filteredPdfRows.map((row) => {
          const book = bookById.get(row.global_book_id);
          return (
            <li key={row.id} className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-4 premium-shadow">
              <p className="line-clamp-2 text-base font-semibold text-[#241A14]">{book?.title ?? 'Global book sin título'}</p>
              <p className="mt-2 inline-flex items-center gap-2 text-xs text-[#6B5A50]">
                <Globe2 size={12} /> {book?.cuisine_region ?? 'Global'} · {book?.cuisine_country ?? 'País no definido'}
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#6B5A50]">
                <span className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">
                  <Layers3 size={11} /> {row.page_count} páginas
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">
                  <Hash size={11} /> {(book?.tags ?? []).length} tags
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-xs text-[#6B5A50]">Archivo: {row.storage_path}</p>
            </li>
          );
        })}
        {!loading && filteredPdfRows.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay resultados para el filtro actual.</li> : null}
      </ul>

      {loading ? <p className="text-sm text-[#6B5A50]">Cargando global PDFs...</p> : null}
    </section>
  );
}
