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

  if (!(await isPlatformOwner(user))) {
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
  const regions = Array.from(
    new Set(
      rows.map((row) => row.cuisine_region).filter((value): value is string => Boolean(value))
    )
  ).sort();
  const allTags = Array.from(
    new Set(
      rows.flatMap((row) => row.tags ?? []).filter((value): value is string => Boolean(value))
    )
  ).sort();

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-5 rounded-[26px] bg-bistro-inverse px-6 py-7 text-white shadow-sm sm:px-8">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-bistro-champagne">
            <FileText size={16} aria-hidden="true" /> Biblioteca de documentos
          </p>
          <h2 className="mt-3 font-bistro-heading text-3xl font-semibold sm:text-4xl">
            Documentos PDF
          </h2>
          <p className="mt-2 max-w-lg text-sm text-bistro-cream">
            Consultá los documentos globales y sus características.
          </p>
        </div>
        <Link
          href="/owner/global-pdfs/upload"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-bistro-action-primary px-5 text-sm font-semibold text-white hover:opacity-90"
        >
          <UploadCloud size={17} aria-hidden="true" /> Cargar nuevo PDF
        </Link>
      </header>

      <section
        aria-label="Resumen de documentos"
        className="grid grid-cols-3 divide-x divide-bistro-border rounded-2xl border border-bistro-border bg-white py-4 shadow-sm"
      >
        {[
          { label: 'Documentos', value: rows.length },
          { label: 'Regiones', value: regions.length },
          { label: 'Etiquetas', value: allTags.length },
        ].map((item) => (
          <div key={item.label} className="min-w-0 px-2 text-center sm:px-5">
            <p className="font-bistro-heading text-2xl font-semibold sm:text-3xl">{item.value}</p>
            <p className="mt-1 text-[11px] text-bistro-text-secondary sm:text-xs">{item.label}</p>
          </div>
        ))}
      </section>

      <section
        aria-labelledby="owner-pdf-list"
        className="overflow-hidden rounded-[24px] border border-bistro-border bg-white shadow-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-bistro-border p-5">
          <div>
            <h3 id="owner-pdf-list" className="font-bistro-heading text-xl font-semibold">
              Documentos registrados
            </h3>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Últimos 24 registros como máximo
            </p>
          </div>
          <span className="rounded-full bg-bistro-page px-3 py-1 text-xs font-semibold text-bistro-action-secondary">
            {rows.length} visibles
          </span>
        </div>
        <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.6fr)] gap-4 border-b border-bistro-border bg-bistro-page/70 px-6 py-3 text-xs font-bold uppercase tracking-wider text-bistro-text-secondary md:grid">
          <span>Documento</span>
          <span>Origen</span>
          <span>Contenido</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <FileText
              size={32}
              className="mx-auto text-bistro-action-secondary"
              aria-hidden="true"
            />
            <p className="mt-4 font-semibold">
              Todavía no hay documentos PDF en la biblioteca global.
            </p>
            <p className="mt-2 text-sm text-bistro-text-secondary">
              Podés comenzar cargando el primer PDF.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-bistro-border">
            {rows.map((row) => (
              <li
                key={row.id}
                className="grid min-w-0 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.6fr)] md:items-center md:gap-4 md:px-6"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-bistro-page text-bistro-action-secondary"
                    aria-hidden="true"
                  >
                    <FileText size={19} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-bistro-text-primary">
                      {row.title ?? 'Libro sin título'}
                    </p>
                    <details className="mt-1 text-xs text-bistro-text-secondary">
                      <summary className="cursor-pointer underline-offset-2 hover:underline">
                        Ver ruta del archivo
                      </summary>
                      <p className="mt-1 break-all">{row.storage_path}</p>
                    </details>
                  </div>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-bistro-text-secondary">
                  <Globe2 size={13} aria-hidden="true" /> {row.cuisine_region ?? 'Global'} ·{' '}
                  {row.cuisine_country ?? 'País no definido'}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-bistro-text-secondary">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-bistro-page px-2.5 py-1.5">
                    <Layers3 size={13} aria-hidden="true" /> {row.page_count} páginas
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-bistro-page px-2.5 py-1.5">
                    <Hash size={13} aria-hidden="true" /> {(row.tags ?? []).length} etiquetas
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
