'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

type PdfRow = {
  id: string;
  tenant_book_id: string | null;
  storage_path: string;
  created_at: string;
  processing_status: 'processing' | 'ready' | 'failed';
  page_count: number | null;
  uploaded_by: string | null;
};

type BookRow = {
  id: string;
  title: string;
  author: string | null;
};

export default function LibraryPage() {
  const [pdfs, setPdfs] = useState<PdfRow[]>([]);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<'owner' | 'admin' | 'member' | null>(null);
  const [tenantType, setTenantType] = useState<'home' | 'professional'>('home');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('No hay sesión activa.');

      const { data: meRow, error: meError } = await supabase
        .from('users')
        .select('id,role,tenant_id')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (meError || !meRow?.tenant_id) throw new Error('No se pudo cargar rol actual.');

      const [
        { data: tenantRow, error: tenantError },
        { data: pdfRows, error: pdfError },
        { data: bookRows, error: bookError },
      ] = await Promise.all([
        supabase.from('tenants').select('tenant_type').eq('id', meRow.tenant_id).maybeSingle(),
        supabase
          .from('tenant_pdf_library')
          .select(
            'id,tenant_book_id,storage_path,created_at,processing_status,page_count,uploaded_by'
          )
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('tenant_books')
          .select('id,title,author')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (tenantError) throw tenantError;
      if (pdfError) throw pdfError;
      if (bookError) throw bookError;

      setCurrentUserId(meRow.id);
      setCurrentRole(meRow.role as 'owner' | 'admin' | 'member');
      setTenantType(tenantRow?.tenant_type === 'professional' ? 'professional' : 'home');
      const nextPdfs = (pdfRows ?? []) as PdfRow[];
      const linkedBookIds = new Set(
        nextPdfs.map((row) => row.tenant_book_id).filter((id): id is string => Boolean(id))
      );
      const nextBooks = ((bookRows ?? []) as BookRow[]).filter((book) =>
        linkedBookIds.has(book.id)
      );

      setPdfs(nextPdfs);
      setBooks(nextBooks);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'No se pudo cargar biblioteca.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const removePdf = async (pdfId: string) => {
    setWorkingId(pdfId);
    setError(null);
    try {
      const response = await fetch(`/api/library/pdfs/${pdfId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'No se pudo eliminar PDF.');
      }

      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo eliminar PDF.');
    } finally {
      setWorkingId(null);
    }
  };

  const canDeletePdf = (pdf: PdfRow): boolean => {
    if (!currentUserId || !currentRole) return false;
    if (currentRole === 'owner' || currentRole === 'admin') return true;
    return pdf.uploaded_by === currentUserId;
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Biblioteca</h1>
            <p className="text-[#6B5A50]">
              Administrá tus PDFs culinarios y libros conectados al RAG.
            </p>
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

        {error ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">PDFs del tenant</h2>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Regla: owner/admin pueden eliminar cualquiera; miembro solo sus propios PDFs.
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Plan {tenantType === 'professional' ? 'Professional' : 'Home'} · límite{' '}
              {tenantType === 'professional' ? 15 : 5} PDFs.
            </p>
            <ul className="mt-3 space-y-2">
              {pdfs.map((pdf) => (
                <li
                  key={pdf.id}
                  className="rounded-xl border border-[#E8DDD2] bg-white/75 p-3 text-sm"
                >
                  <p className="font-medium text-[#241A14] line-clamp-1">
                    {pdf.storage_path.split('/').pop() ?? pdf.storage_path}
                  </p>
                  <p className="text-xs text-[#6B5A50]">
                    Estado: {pdf.processing_status} · Páginas: {pdf.page_count ?? '-'}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-[#6B5A50]">
                      {new Date(pdf.created_at).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      disabled={workingId === pdf.id || !canDeletePdf(pdf)}
                      onClick={() => void removePdf(pdf.id)}
                      className="rounded-lg border border-[#E8DDD2] px-2 py-1 font-semibold text-[#A55412] hover:border-[#C56A1A]/40 disabled:cursor-not-allowed disabled:opacity-60"
                      title={
                        canDeletePdf(pdf)
                          ? 'Eliminar PDF'
                          : 'No tienes permiso para eliminar este PDF'
                      }
                    >
                      {workingId === pdf.id
                        ? 'Eliminando...'
                        : canDeletePdf(pdf)
                          ? 'Eliminar'
                          : 'Sin permiso'}
                    </button>
                  </div>
                </li>
              ))}
              {!loading && pdfs.length === 0 ? (
                <li className="text-sm text-[#6B5A50]">No hay PDFs cargados.</li>
              ) : null}
            </ul>
          </article>

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Libros vinculados</h2>
            <ul className="mt-3 space-y-2">
              {books.map((book) => (
                <li
                  key={book.id}
                  className="rounded-xl border border-[#E8DDD2] bg-white/75 p-3 text-sm"
                >
                  <p className="font-medium text-[#241A14]">{book.title}</p>
                  <p className="text-xs text-[#6B5A50]">
                    Autor: {book.author ?? 'No especificado'}
                  </p>
                </li>
              ))}
              {!loading && books.length === 0 ? (
                <li className="text-sm text-[#6B5A50]">No hay libros vinculados.</li>
              ) : null}
            </ul>
          </article>
        </div>

        {loading ? <p className="mt-3 text-sm text-[#6B5A50]">Cargando biblioteca...</p> : null}
      </section>
    </main>
  );
}
