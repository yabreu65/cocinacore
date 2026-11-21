'use client';
import { postgresTimestampDisplayDate } from '@/lib/db/postgres-timestamp';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bookmark,
  BookOpen,
  CalendarDays,
  ChevronRight,
  History,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { humanCopy } from '@/lib/copy';
import { safeFetch } from '@/lib/api';
import { createHistoryOperationGate, type HistoryOperation } from './history-operation-gate';
import {
  buildRecipeImportFromHistory,
  historyImportIngredientLimitExceeded,
} from '@/lib/recipes/recipe-history-import';
import { getHistoryRecipeSources } from '@/lib/recipes/source-citations';
import {
  RecipeEditor,
  draftFromImport,
  payloadFromDraft,
  type Draft,
} from '../RecipeLibraryClient';

type HistoryFilter = 'all' | 'saved';

type HistoryRow = {
  id: string;
  recipe_title: string | null;
  recipe_payload: unknown;
  user_feedback: 'accepted' | 'discarded' | null;
  created_at: string;
  is_saved: boolean;
};

function toPrettyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (typeof obj.full_recipe === 'string' && obj.full_recipe.trim().length > 0) {
      return obj.full_recipe;
    }

    const title = typeof obj.title === 'string' ? obj.title : null;
    const summary = typeof obj.summary === 'string' ? obj.summary : null;
    const ingredients = Array.isArray(obj.ingredients)
      ? obj.ingredients.filter((item): item is string => typeof item === 'string')
      : [];
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((item): item is string => typeof item === 'string')
      : [];
    const tips = Array.isArray(obj.tips)
      ? obj.tips.filter((item): item is string => typeof item === 'string')
      : [];

    const blocks: string[] = [];
    if (title) blocks.push(`# ${title}`);
    if (summary) blocks.push(summary);
    if (ingredients.length > 0) {
      blocks.push('## Ingredientes');
      blocks.push(...ingredients.map((item) => `- ${item}`));
    }
    if (steps.length > 0) {
      blocks.push('## Preparación');
      blocks.push(...steps.map((item, index) => `${index + 1}. ${item}`));
    }
    if (tips.length > 0) {
      blocks.push('## Tips');
      blocks.push(...tips.map((item) => `- ${item}`));
    }

    if (blocks.length > 0) return blocks.join('\n');
    return JSON.stringify(payload, null, 2);
  }
  return 'Sin detalle disponible.';
}

/** A display-only preview. The original payload remains available in «Ver detalle». */
function historyPreview(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const obj = payload as Record<string, unknown>;
  const raw =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary
      : typeof obj.full_recipe === 'string'
        ? obj.full_recipe
        : '';
  const preview = raw.replace(/\s+/g, ' ').trim();
  if (!preview) return null;
  return preview.length > 150 ? preview.slice(0, 147).trimEnd() + '…' : preview;
}

export default function RecipeHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  // Server and initial client render must agree; URL preference is read after hydration.
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [filterReady, setFilterReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const gate = useRef(createHistoryOperationGate());
  const [pending, setPending] = useState(new Map<string, HistoryOperation>());
  const [importedRecipes, setImportedRecipes] = useState<Record<string, string>>({});
  const importedIds = useRef(new Set<string>());
  const filterRef = useRef<HistoryFilter>('all');
  const loadingRef = useRef(true);
  const loadEpoch = useRef(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const changeFilter = useCallback((next: HistoryFilter) => {
    if (filterRef.current === next) return;
    filterRef.current = next;
    loadEpoch.current += 1;
    loadingRef.current = true;
    setLoading(true);
    setRows([]);
    setReviewId(null);
    setError(null);
    setLoadError(null);
    setFilter(next);
  }, []);

  const beginOperation = (id: string, operation: HistoryOperation) => {
    if (loadingRef.current || !gate.current.begin(id, operation)) return false;
    setPending(gate.current.snapshot());
    return true;
  };

  const finishOperation = (id: string, operation: HistoryOperation, reload = true) => {
    gate.current.finish(id, operation);
    setPending(gate.current.snapshot());
    if ((reload || loadingRef.current) && gate.current.size === 0) {
      loadingRef.current = true;
      setLoading(true);
      setReloadVersion((current) => current + 1);
    }
  };

  useEffect(() => {
    const readFilterFromUrl = () => {
      const isSaved = new URLSearchParams(window.location.search).get('saved') === 'true';
      changeFilter(isSaved ? 'saved' : 'all');
      setFilterReady(true);
    };
    readFilterFromUrl();
    window.addEventListener('popstate', readFilterFromUrl);
    return () => window.removeEventListener('popstate', readFilterFromUrl);
  }, [changeFilter]);

  useEffect(() => {
    if (!filterReady || gate.current.size > 0) return;
    const controller = new AbortController();
    const epoch = ++loadEpoch.current;
    let current = true;
    const isCurrent = () => current && loadEpoch.current === epoch && filterRef.current === filter;
    loadingRef.current = true;
    setLoading(true);
    setLoadError(null);
    const load = async () => {
      try {
        const path = filter === 'saved' ? '/api/recipe-history?saved=true' : '/api/recipe-history';
        const result = await safeFetch<{ items: HistoryRow[] }>(path, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!isCurrent()) return;
        if (!result.ok) throw new Error(result.error);
        setRows(result.data.items);
        setLoadError(null);
      } catch (cause) {
        if (!isCurrent() || (cause instanceof Error && cause.name === 'AbortError')) return;
        setRows([]);
        setLoadError(cause instanceof Error ? cause.message : 'No se pudo cargar historial.');
      } finally {
        if (isCurrent()) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [filter, filterReady, reloadVersion]);

  const updateFilter = (nextFilter: HistoryFilter) => {
    const url = new URL(window.location.href);
    if (nextFilter === 'saved') {
      url.searchParams.set('saved', 'true');
    } else {
      url.searchParams.delete('saved');
    }
    window.history.replaceState(null, '', url);
    changeFilter(nextFilter);
  };

  const deleteHistoryItem = async (id: string) => {
    if (!beginOperation(id, 'delete')) return;
    setError(null);
    try {
      const result = await safeFetch<{ ok: true }>(
        `/api/recipe-history?id=${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
        }
      );
      if (!result.ok) throw new Error(result.error);
      setRows((prev) => prev.filter((row) => row.id !== id));
      setOpenId((current) => (current === id ? null : current));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la receta.');
    } finally {
      finishOperation(id, 'delete');
    }
  };

  const setFeedback = async (id: string, value: 'accepted' | 'discarded') => {
    if (!beginOperation(id, 'feedback')) return;
    setError(null);
    try {
      const result = await safeFetch<{ item: HistoryRow }>(
        `/api/recipe-history?id=${encodeURIComponent(id)}&feedback=${value}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
        }
      );
      if (!result.ok) throw new Error(result.error);
      setRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, user_feedback: value } : row))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar feedback.');
    } finally {
      finishOperation(id, 'feedback');
    }
  };

  const setSaved = async (entry: HistoryRow) => {
    const nextSaved = !entry.is_saved;
    if (!beginOperation(entry.id, 'save')) return;
    setError(null);
    try {
      const result = await safeFetch<{ item: HistoryRow }>(
        `/api/recipe-history?id=${encodeURIComponent(entry.id)}&saved=${nextSaved}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
        }
      );
      if (!result.ok) throw new Error(result.error);
      setRows((prev) => {
        if (filterRef.current === 'saved' && !result.data.item.is_saved) {
          return prev.filter((row) => row.id !== entry.id);
        }
        return prev.map((row) =>
          row.id === entry.id ? { ...row, is_saved: result.data.item.is_saved } : row
        );
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la receta guardada.');
    } finally {
      finishOperation(entry.id, 'save');
    }
  };

  const importToRecetario = async (entry: HistoryRow, draft: Draft) => {
    if (reviewId !== entry.id || importedIds.current.has(entry.id)) return;
    const body = { ...payloadFromDraft(draft), sourceRecipeHistoryId: entry.id };
    if (!beginOperation(entry.id, 'import')) return;
    setError(null);
    try {
      const result = await safeFetch<{ recipe: { id: string } }>('/api/recipes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!result.ok || !result.data.recipe.id) {
        throw new Error('No se pudo importar la receta.');
      }
      importedIds.current.add(entry.id);
      setReviewId((current) => (current === entry.id ? null : current));
      setImportedRecipes((current) => ({ ...current, [entry.id]: result.data.recipe.id }));
    } catch {
      setError('No pudimos llevar la receta a tu recetario. Podés intentarlo nuevamente.');
    } finally {
      finishOperation(entry.id, 'import', importedIds.current.has(entry.id));
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="rounded-3xl bg-bistro-inverse px-4 py-4 text-white shadow-sm sm:px-8 sm:py-7">
          <div className="flex items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-bistro-champagne">
              <History aria-hidden="true" className="h-4 w-4" />
              Tu cocina, con memoria
            </p>
            <Link
              href="/recipes"
              className="shrink-0 rounded-xl border border-white/35 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10 sm:text-sm"
            >
              Mi recetario
            </Link>
          </div>
          <h1 className="mt-2 font-bistro-heading text-2xl font-semibold leading-tight sm:text-4xl">
            Historial de recetas
          </h1>
          <p className="mt-2 hidden max-w-xl text-sm leading-relaxed text-bistro-cream sm:block sm:text-base">
            Volvé a encontrar las ideas que preparaste con el asistente.
          </p>
          <Link
            href="/recipes/search"
            className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-bistro-champagne px-4 py-2 text-sm font-bold text-bistro-text-primary transition hover:bg-white"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Buscar recetas
          </Link>
        </header>

        <section
          aria-label="Organizar historial de recetas"
          className="mt-4 rounded-2xl border border-bistro-border bg-white p-3 shadow-sm sm:p-5"
        >
          <div className="flex items-start gap-2 rounded-xl bg-bistro-surface-warm px-3 py-2.5 text-xs leading-relaxed text-bistro-text-primary sm:gap-3 sm:text-sm">
            <BookOpen
              aria-hidden="true"
              className="mt-0.5 h-5 w-5 shrink-0 text-bistro-action-primary"
            />
            <p>
              <strong>Marcar una idea no la guarda en Mi recetario.</strong> Para conservarla, usá
              «Importar a Mi recetario» y revisala antes de confirmar.
            </p>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="font-bistro-heading text-lg font-semibold text-bistro-text-primary sm:text-xl">
                Tus ideas generadas
              </h2>
              <p role="status" className="mt-1 text-sm text-bistro-text-secondary">
                {loading
                  ? 'Cargando historial…'
                  : loadError
                    ? 'No se pudo cargar el historial'
                    : rows.length + (rows.length === 1 ? ' idea encontrada' : ' ideas encontradas')}
              </p>
            </div>
            <label className="grid min-w-0 w-40 gap-1 text-xs font-semibold text-bistro-text-primary sm:w-52 sm:text-sm">
              Mostrar recetas
              <select
                value={filter}
                disabled={reviewId !== null}
                onChange={(event) => updateFilter(event.target.value as HistoryFilter)}
                className="min-h-11 w-full rounded-xl border border-bistro-border bg-bistro-page px-2 py-2 text-sm font-normal text-bistro-text-primary disabled:opacity-60 sm:px-3 sm:text-base"
              >
                <option value="all">Todas</option>
                <option value="saved">Marcadas para consultar</option>
              </select>
            </label>
          </div>
        </section>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 p-4 text-sm text-bistro-danger"
          >
            {error}
          </p>
        ) : null}
        {loadError ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 p-4 text-sm text-bistro-danger"
          >
            <p>{loadError}</p>
            <button
              type="button"
              disabled={loading || pending.size > 0}
              onClick={() => setReloadVersion((current) => current + 1)}
              className="mt-2 min-h-10 font-semibold underline disabled:opacity-60"
            >
              Reintentar carga del historial
            </button>
          </div>
        ) : null}
        {!loading && !loadError && rows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-bistro-border bg-white px-5 py-8 text-center">
            <BookOpen aria-hidden="true" className="mx-auto h-10 w-10 text-bistro-action-primary" />
            <h2 className="mt-3 font-bistro-heading text-xl font-semibold">
              {filter === 'saved' ? 'Aún no hay ideas marcadas' : 'Tu historial empieza aquí'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-bistro-text-secondary">
              {filter === 'saved'
                ? 'Aún no hay ideas marcadas para consultar.'
                : 'Aún no tienes recetas en el historial.'}
            </p>
            <Link
              href="/recipes/search"
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Encontrar recetas
            </Link>
          </div>
        ) : null}

        <ul aria-label="Recetas del historial" className="mt-4 grid gap-4 sm:grid-cols-2">
          {rows.map((entry) => {
            const isOpen = openId === entry.id;
            const sources =
              isOpen || reviewId === entry.id ? getHistoryRecipeSources(entry.recipe_payload) : [];
            const operation = pending.get(entry.id);
            const busy = loading || operation !== undefined;
            const otherReview = reviewId !== null && reviewId !== entry.id;
            const importDraft = buildRecipeImportFromHistory({
              id: entry.id,
              title: entry.recipe_title,
              payload: entry.recipe_payload,
            });
            const preview = historyPreview(entry.recipe_payload);
            return (
              <li
                key={entry.id}
                className="flex min-w-0 flex-col rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-bistro-text-secondary">
                  <CalendarDays aria-hidden="true" className="h-4 w-4" />
                  <span>{postgresTimestampDisplayDate(entry.created_at).toLocaleString()}</span>
                  {entry.is_saved ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-bistro-surface-warm px-2.5 py-1 text-bistro-action-secondary">
                      <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
                      Marcada
                    </span>
                  ) : null}
                </div>
                <h2 className="mt-3 min-w-0 break-words font-bistro-heading text-xl font-semibold leading-snug text-bistro-text-primary">
                  {entry.recipe_title ?? humanCopy.suggestedRecipesForYou}
                </h2>
                {preview ? (
                  <p className="mt-2 min-w-0 flex-1 break-words text-sm leading-relaxed text-bistro-text-secondary">
                    {preview}
                  </p>
                ) : (
                  <p className="mt-2 flex-1 text-sm text-bistro-text-secondary">
                    Abrí el detalle para consultar la propuesta.
                  </p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : entry.id)}
                    aria-expanded={isOpen}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-page"
                  >
                    {isOpen ? 'Ocultar' : 'Ver detalle'}
                  </button>
                  {importedRecipes[entry.id] ? (
                    <Link
                      href={'/recipes/' + importedRecipes[entry.id]}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-bistro-action-secondary px-3 py-2 text-center text-sm font-semibold text-white"
                    >
                      Ver en Mi recetario
                    </Link>
                  ) : importDraft && reviewId !== entry.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!loadingRef.current && gate.current.size === 0) setReviewId(entry.id);
                      }}
                      disabled={busy || otherReview || pending.size > 0}
                      className="min-h-11 rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {operation === 'import' ? 'Importando…' : 'Importar a Mi recetario'}
                    </button>
                  ) : (
                    <span className="grid min-h-11 place-items-center text-center text-xs text-bistro-text-secondary">
                      {reviewId === entry.id ? 'Revisando receta' : 'Solo consulta'}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void setSaved(entry)}
                  aria-pressed={entry.is_saved}
                  disabled={busy || reviewId !== null}
                  className="mt-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-sm font-semibold text-bistro-action-primary transition hover:bg-bistro-surface-warm disabled:opacity-70"
                >
                  <Bookmark aria-hidden="true" className="h-4 w-4" />
                  {entry.is_saved ? 'Quitar marca' : 'Marcar para consultar'}
                </button>

                {!importedRecipes[entry.id] && !importDraft ? (
                  <p className="mt-3 rounded-xl bg-bistro-surface-warm p-3 text-sm leading-relaxed text-bistro-text-secondary">
                    {historyImportIngredientLimitExceeded(entry.recipe_payload)
                      ? 'No se puede importar esta receta: supera el límite de 100 ingredientes.'
                      : 'No se puede importar esta receta sin alterar sus datos.'}{' '}
                    La receta original sigue disponible en «Ver detalle».
                  </p>
                ) : null}

                {reviewId === entry.id && importDraft && !importedRecipes[entry.id] ? (
                  <section
                    aria-label="Revisar antes de importar"
                    className="mt-4 rounded-xl border border-bistro-border bg-bistro-page p-3 sm:p-4"
                  >
                    <p className="mb-3 text-sm leading-relaxed text-bistro-text-secondary">
                      Propuesta generada: revisá que los ingredientes y cantidades correspondan a
                      los pasos. Revisá también etiquetas y contaminación cruzada. No certifica
                      ausencia de alérgenos.
                    </p>
                    <RecipeEditor
                      key={entry.id}
                      initial={draftFromImport(importDraft)}
                      saving={busy}
                      saveLabel="Confirmar y guardar"
                      onSave={(draft) => void importToRecetario(entry, draft)}
                      onCancel={() => setReviewId(null)}
                    />
                  </section>
                ) : null}

                {sources.length > 0 ? (
                  <section
                    className="mt-4 rounded-xl border border-bistro-border bg-bistro-page p-3"
                    aria-label="Fuentes del recetario"
                  >
                    <h3 className="text-sm font-semibold">
                      Fuentes consultadas para la propuesta original
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-bistro-text-secondary">
                      Las fuentes describen el contexto consultado, no certifican una transcripción
                      ni los cambios del usuario.
                    </p>
                    <ul className="mt-2 grid gap-2">
                      {sources.map((source) => (
                        <li
                          key={JSON.stringify([
                            source.sourceType,
                            source.sourceId,
                            source.pageNumber,
                            source.chunkId,
                          ])}
                          className="min-w-0 rounded-lg border border-bistro-border bg-white px-3 py-2 text-sm"
                        >
                          <p className="break-words font-medium">{source.label}</p>
                          {source.title ? <p className="break-words">{source.title}</p> : null}
                          {source.pageNumber ? <p>Página {source.pageNumber}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                {isOpen ? (
                  <pre className="mt-4 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-bistro-border bg-bistro-page p-3 text-sm leading-relaxed text-bistro-text-primary [overflow-wrap:anywhere]">
                    {toPrettyPayload(entry.recipe_payload)}
                  </pre>
                ) : null}

                <details className="group mt-3 rounded-xl border border-bistro-border">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-bistro-action-primary [&::-webkit-details-marker]:hidden">
                    Más opciones
                    <ChevronRight
                      aria-hidden="true"
                      className="h-4 w-4 transition-transform group-open:rotate-90"
                    />
                  </summary>
                  <div className="grid gap-3 border-t border-bistro-border px-3 py-3">
                    <p className="text-xs font-semibold text-bistro-text-secondary">
                      ¿Qué te pareció esta idea?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void setFeedback(entry.id, 'accepted')}
                        aria-pressed={entry.user_feedback === 'accepted'}
                        disabled={busy || reviewId !== null}
                        className={
                          'min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-70 ' +
                          (entry.user_feedback === 'accepted'
                            ? 'border-bistro-action-secondary/40 bg-bistro-action-secondary/10 text-bistro-action-secondary'
                            : 'border-bistro-border bg-white text-bistro-text-secondary')
                        }
                      >
                        Me gustó
                      </button>
                      <button
                        type="button"
                        onClick={() => void setFeedback(entry.id, 'discarded')}
                        aria-pressed={entry.user_feedback === 'discarded'}
                        disabled={busy || reviewId !== null}
                        className={
                          'min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-70 ' +
                          (entry.user_feedback === 'discarded'
                            ? 'border-bistro-danger/30 bg-bistro-danger/10 text-bistro-danger'
                            : 'border-bistro-border bg-white text-bistro-text-secondary')
                        }
                      >
                        No me gustó
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            '¿Eliminar esta propuesta del historial? Esta acción no se puede deshacer.'
                          )
                        ) {
                          void deleteHistoryItem(entry.id);
                        }
                      }}
                      disabled={busy || reviewId !== null}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-bistro-danger/30 bg-white px-3 py-2 text-sm font-semibold text-bistro-danger disabled:opacity-70"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                      {operation === 'delete' ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
