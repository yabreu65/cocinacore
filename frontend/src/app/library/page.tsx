import { postgresTimestampDisplayDate } from '@/lib/db/postgres-timestamp';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';
import { scopedTransaction } from '@/lib/db';
import type { PdfProcessingStatus } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type PdfRow = {
  id: string;
  tenant_book_id: string | null;
  storage_path: string;
  created_at: string;
  processing_status: PdfProcessingStatus;
  page_count: number | null;
  uploaded_by: string | null;
};

type BookRow = {
  id: string;
  title: string;
  author: string | null;
};

type GlobalBookRow = BookRow & {
  description: string | null;
  cuisine_region: string;
};

export default async function LibraryPage() {
  const user = await getCurrentUser();

  if (!user?.tenant) {
    return (
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
          <p className="text-xs font-bold uppercase tracking-wider text-bistro-champagne">
            Fuentes de inspiración
          </p>
          <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
            Biblioteca
          </h1>
          <p className="mt-2 text-bistro-text-secondary">
            Necesitás iniciar sesión para ver tu biblioteca.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white"
          >
            Ir a login
          </Link>
        </section>
      </main>
    );
  }

  const tenantId = user.tenant.tenantId;
  const { result, globalResult } = await scopedTransaction(
    { tenantId, userId: user.id },
    async (client) => {
      const result = await client.query<
        PdfRow & {
          book_id: string | null;
          book_title: string | null;
          book_author: string | null;
        }
      >(
        `with visible_pdfs as (
         select id, tenant_id, tenant_book_id, storage_path, created_at, processing_status, page_count, uploaded_by
         from public.tenant_pdf_library
         where tenant_id = $1
         order by created_at desc, id desc
         limit 50
       )
       select p.*, b.id as book_id, b.title as book_title, b.author as book_author
       from visible_pdfs p
       left join public.tenant_books b on b.id = p.tenant_book_id and b.tenant_id = $1
       order by p.created_at desc, p.id desc`,
        [tenantId]
      );
      const globalResult = await client.query<GlobalBookRow>(
        `select b.id, b.title, b.author, b.description, b.cuisine_region
       from public.global_books b
       where exists (select 1 from public.global_pdf_library p where p.global_book_id = b.id)
       order by b.title, b.id`
      );
      return { result, globalResult };
    }
  );
  const pdfs = result.rows;
  const booksById = new Map<string, BookRow>();
  for (const row of pdfs) {
    if (row.book_id && row.book_title !== null) {
      booksById.set(row.book_id, {
        id: row.book_id,
        title: row.book_title,
        author: row.book_author,
      });
    }
  }
  const books = [...booksById.values()];

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <h1 className="text-3xl font-semibold">Biblioteca</h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
              Consultá los documentos y libros disponibles en tu biblioteca.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/library/upload"
              className="inline-flex min-h-11 items-center rounded-xl bg-white px-3 py-2 text-sm font-semibold text-bistro-inverse hover:bg-bistro-cream"
            >
              Subir libro PDF
            </Link>
            <Link
              href="/recipes/search"
              className="inline-flex min-h-11 items-center rounded-xl border border-white/40 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
            >
              Abrir buscador
            </Link>
            <Link
              href="/app"
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-white underline-offset-4 hover:underline"
            >
              Volver
            </Link>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
          Los libros PDF que subas son fuentes privadas de tu hogar y se mantienen separados del
          catálogo global.
        </div>

        <article className="mb-4 rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">Libros globales</h2>
          <p className="mt-1 text-xs text-bistro-text-secondary">
            Catálogo de consulta de libros con PDF.
          </p>
          <ul className="mt-3 space-y-2">
            {globalResult.rows.map((book) => (
              <li
                key={book.id}
                className="rounded-xl border border-bistro-border bg-white/75 p-3 text-sm"
              >
                <p className="font-medium text-bistro-text-primary">{book.title}</p>
                <p className="text-xs text-bistro-text-secondary">
                  Autor: {book.author ?? 'No especificado'}
                </p>
                {book.description ? (
                  <p className="mt-1 text-sm text-bistro-text-secondary">{book.description}</p>
                ) : null}
                {book.cuisine_region ? (
                  <p className="mt-1 text-xs text-bistro-text-secondary">
                    Región: {book.cuisine_region}
                  </p>
                ) : null}
              </li>
            ))}
            {globalResult.rows.length === 0 ? (
              <li className="text-sm text-bistro-text-secondary">
                No hay libros globales disponibles.
              </li>
            ) : null}
          </ul>
        </article>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">PDFs del tenant</h2>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Plan {user.tenant.tenantType === 'professional' ? 'Professional' : 'Home'} · límite{' '}
              {user.tenant.tenantType === 'professional' ? 15 : 5} PDFs.
            </p>
            <ul className="mt-3 space-y-2">
              {pdfs.map((pdf) => (
                <li
                  key={pdf.id}
                  className="rounded-xl border border-bistro-border bg-white/75 p-3 text-sm"
                >
                  <p className="font-medium text-bistro-text-primary line-clamp-1">
                    {pdf.storage_path.split('/').pop() ?? pdf.storage_path}
                  </p>
                  <p className="text-xs text-bistro-text-secondary">
                    Estado: {pdf.processing_status} · Páginas: {pdf.page_count ?? '-'}
                  </p>
                  <p className="mt-2 text-xs text-bistro-text-secondary">
                    {postgresTimestampDisplayDate(pdf.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
              {pdfs.length === 0 ? (
                <li className="text-sm text-bistro-text-secondary">No hay PDFs cargados.</li>
              ) : null}
            </ul>
          </article>

          <article className="rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Libros vinculados</h2>
            <ul className="mt-3 space-y-2">
              {books.map((book) => (
                <li
                  key={book.id}
                  className="rounded-xl border border-bistro-border bg-white/75 p-3 text-sm"
                >
                  <p className="font-medium text-bistro-text-primary">{book.title}</p>
                  <p className="text-xs text-bistro-text-secondary">
                    Autor: {book.author ?? 'No especificado'}
                  </p>
                </li>
              ))}
              {books.length === 0 ? (
                <li className="text-sm text-bistro-text-secondary">No hay libros vinculados.</li>
              ) : null}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
