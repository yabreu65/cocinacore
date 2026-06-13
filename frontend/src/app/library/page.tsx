import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
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
      <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Biblioteca</h1>
          <p className="mt-2 text-[#6B5A50]">Necesitás iniciar sesión para ver tu biblioteca.</p>
          <Link href="/login" className="mt-4 inline-flex rounded-xl bg-[#C56A1A] px-4 py-2 font-semibold text-white">
            Ir a login
          </Link>
        </section>
      </main>
    );
  }

  const tenantId = user.tenant.tenantId;
  const [pdfsResult, booksResult] = await Promise.all([
    query<PdfRow>(
      `select id, tenant_book_id, storage_path, created_at, processing_status, page_count, uploaded_by
       from public.tenant_pdf_library
       where tenant_id = $1
       order by created_at desc
       limit 50`,
      [tenantId]
    ),
    query<BookRow>(
      `select id, title, author
       from public.tenant_books
       where tenant_id = $1
       order by created_at desc
       limit 50`,
      [tenantId]
    ),
  ]);

  const pdfs = pdfsResult.rows;
  const books = booksResult.rows.filter((book) => pdfs.some((pdf) => pdf.tenant_book_id === book.id));

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Biblioteca</h1>
            <p className="text-[#6B5A50]">Vista mínima ya migrada a PostgreSQL directo.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/recipes/search"
              className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
            >
              Abrir buscador
            </Link>
            <Link href="/app" className="text-sm font-semibold text-[#A55412]">
              Volver
            </Link>
          </div>
        </div>

        <div className="mb-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4 text-sm text-[#6B5A50]">
          Eliminación y edición quedan en reconstrucción. La página renderiza con datos reales sin
          depender de Supabase.
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">PDFs del tenant</h2>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Plan {user.tenant.tenantType === 'professional' ? 'Professional' : 'Home'} · límite{' '}
              {user.tenant.tenantType === 'professional' ? 15 : 5} PDFs.
            </p>
            <ul className="mt-3 space-y-2">
              {pdfs.map((pdf) => (
                <li key={pdf.id} className="rounded-xl border border-[#E8DDD2] bg-white/75 p-3 text-sm">
                  <p className="font-medium text-[#241A14] line-clamp-1">
                    {pdf.storage_path.split('/').pop() ?? pdf.storage_path}
                  </p>
                  <p className="text-xs text-[#6B5A50]">
                    Estado: {pdf.processing_status} · Páginas: {pdf.page_count ?? '-'}
                  </p>
                  <p className="mt-2 text-xs text-[#6B5A50]">{new Date(pdf.created_at).toLocaleString()}</p>
                </li>
              ))}
              {pdfs.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay PDFs cargados.</li> : null}
            </ul>
          </article>

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Libros vinculados</h2>
            <ul className="mt-3 space-y-2">
              {books.map((book) => (
                <li key={book.id} className="rounded-xl border border-[#E8DDD2] bg-white/75 p-3 text-sm">
                  <p className="font-medium text-[#241A14]">{book.title}</p>
                  <p className="text-xs text-[#6B5A50]">Autor: {book.author ?? 'No especificado'}</p>
                </li>
              ))}
              {books.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay libros vinculados.</li> : null}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
