'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { uploadPrivatePdf } from './private-pdf-upload';

type Progress = { stage: 'extract' | 'embed' | 'wait' | 'upload'; completed: number; total: number; seconds?: number };

export default function LibraryUploadPage() {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (working) return;
    setError('');
    setSuccess(false);
    if (!file) { setError('Seleccioná un archivo PDF.'); return; }
    setWorking(true);
    try {
      await uploadPrivatePdf(file, title, author, setProgress);
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error && (caught.name === 'TimeoutError' || caught.name === 'AbortError')
        ? 'La generación de embeddings tardó demasiado. No se guardó el PDF; intentá nuevamente.'
        : caught instanceof Error ? caught.message : 'No se pudo procesar el PDF.');
    } finally {
      setWorking(false);
      setProgress(null);
    }
  }

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto max-w-3xl space-y-5">
        <header className="rounded-3xl bg-bistro-inverse p-6 text-white sm:p-8">
          <h1 className="font-bistro-heading text-3xl font-semibold">Subir libro PDF</h1>
          <p className="mt-2 text-sm text-bistro-cream">Agregá un libro como fuente privada de tu hogar, separado del catálogo global.</p>
        </header>
        {success ? (
          <div role="status" className="rounded-2xl border border-bistro-action-secondary/30 bg-white p-5">
            <p>Libro PDF cargado e indexado correctamente.</p>
            <Link href="/library" className="mt-3 inline-block font-semibold text-bistro-action-secondary underline">Volver a la biblioteca</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 rounded-2xl border border-bistro-border bg-white p-5 shadow-sm sm:p-7">
            <p className="text-sm text-bistro-text-secondary">Límite por plan: Home 5 PDF · Professional 15 PDF. El servidor comprueba el límite al guardar.</p>
            <label className="block space-y-1.5 text-sm font-semibold">Título (obligatorio)
              <input required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} disabled={working} className="min-h-11 w-full rounded-xl border border-bistro-border px-3" />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold">Autor (opcional)
              <input maxLength={160} value={author} onChange={(event) => setAuthor(event.target.value)} disabled={working} className="min-h-11 w-full rounded-xl border border-bistro-border px-3" />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold">Archivo PDF
              <input required type="file" accept="application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={working} aria-describedby="pdf-requirements" className="block w-full text-sm" />
            </label>
            <p id="pdf-requirements" className="text-sm text-bistro-text-secondary">Máximo 10 MiB, 500 páginas y 1000 fragmentos. El PDF debe contener texto extraíble; no se aplica OCR.</p>
            {progress ? <div role="status" aria-live="polite" className="rounded-xl bg-bistro-page p-4 text-sm">
              <p>{progress.stage === 'extract' ? `Extrayendo texto: ${progress.completed} de ${progress.total || '…'} páginas` : progress.stage === 'embed' ? `Generando embeddings por lotes: ${progress.completed} de ${progress.total} fragmentos` : progress.stage === 'wait' ? `Pausa por cuota: ${progress.seconds} segundos. ${progress.completed} de ${progress.total} fragmentos.` : 'Guardando el PDF y su índice en el servidor…'}</p>
              {progress.total > 0 ? <progress aria-label="Progreso de procesamiento" value={progress.completed} max={progress.total} className="mt-2 w-full" /> : null}
              <p className="mt-2">Mantené esta página abierta hasta que termine el proceso.</p>
            </div> : null}
            {error ? <p role="alert" className="rounded-xl bg-bistro-danger/10 p-3 text-sm text-bistro-danger">{error}</p> : null}
            <button type="submit" disabled={working} className="min-h-11 rounded-xl bg-bistro-action-primary px-5 font-semibold text-white disabled:opacity-60">{working ? 'Procesando…' : 'Subir e indexar PDF'}</button>
          </form>
        )}
        {!success ? <Link href="/library" className="inline-block font-semibold text-bistro-action-secondary underline">Volver a la biblioteca</Link> : null}
      </section>
    </main>
  );
}
