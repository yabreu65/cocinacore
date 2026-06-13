import Link from 'next/link';
import { FileText, Globe2, Hash, Layers3, UploadCloud } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

export const dynamic = 'force-dynamic';

type GlobalPdfRow = {
  id: string;
  storage_path: string;
  page_count: number;
  created_at: string;
  title: string | null;
  cuisine_region: string | null;
  cuisine_country: string | null;
  tags: string[] | null;
};

export default async function OwnerGlobalPdfsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  if (!(await isPlatformOwner(user.id))) {
    redirect('/app');
  }

  const result = await query<GlobalPdfRow>(
    `select pdf.id,
            pdf.storage_path,
            pdf.page_count,
            pdf.created_at,
            book.title,
            book.cuisine_region,
            book.cuisine_country,
            book.tags
     from public.global_pdf_library pdf
     left join public.global_books book on book.id = pdf.global_book_id
     order by pdf.created_at desc
     limit 24`
  );

  const rows = result.rows;
  const regions = Array.from(new Set(rows.map((row) => row.cuisine_region).filter((value): value is string => Boolean(value)))).sort();
  const allTags = Array.from(
    new Set(rows.flatMap((row) => row.tags ?? []).filter((value): value is string => Boolean(value)))
  ).sort();

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
              <FileText size={14} /> Repositorio global indexable
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Global PDFs</h2>
            <p className="mt-1 text-sm text-[#6B5A50]">Listado mínimo ya migrado a PostgreSQL directo.</p>
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
            <p className="line-clamp-2 text-base font-semibold text-[#241A14]">{row.title ?? 'Global book sin título'}</p>
            <p className="mt-2 inline-flex items-center gap-2 text-xs text-[#6B5A50]">
              <Globe2 size={12} /> {row.cuisine_region ?? 'Global'} · {row.cuisine_country ?? 'País no definido'}
            </p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-[#6B5A50]">
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">
                <Layers3 size={11} /> {row.page_count} páginas
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1">
                <Hash size={11} /> {(row.tags ?? []).length} tags
              </span>
            </div>
            <p className="mt-2 line-clamp-1 text-xs text-[#6B5A50]">Archivo: {row.storage_path}</p>
          </li>
        ))}
        {rows.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay PDFs globales cargados.</li> : null}
      </ul>
    </section>
  );
}
