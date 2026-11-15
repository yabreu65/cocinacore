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

export default async function LibraryPage() {
  const user = await getCurrentUser();

  if (!user?.tenant) {
    return (
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Biblioteca</h1>
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
  const result = await scopedTransaction({ tenantId, userId: user.id }, (client) =>
    client.query<
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
    )
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
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Biblioteca</h1>
            <p className="text-bistro-text-secondary">
              Vista mínima ya migrada a PostgreSQL directo.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/recipes/search"
              className="rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-text-secondary hover:border-bistro-action-primary/40"
            >
              Abrir buscador
            </Link>
            <Link href="/app" className="text-sm font-semibold text-bistro-action-primary">
              Volver
            </Link>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-bistro-border bg-white/70 p-4 text-sm text-bistro-text-secondary">
          Eliminación y edición quedan en reconstrucción. La página renderiza con datos reales sobre
          PostgreSQL directo.
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-bistro-border bg-white/70 p-4">
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

          <article className="rounded-2xl border border-bistro-border bg-white/70 p-4">
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
