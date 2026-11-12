'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { humanCopy } from '@/lib/copy';
import { safeFetch } from '@/lib/api';
import { buildRecipeImportFromHistory } from '@/lib/recipes/recipe-history-import';

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

export default function RecipeHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  // Server and initial client render must agree; URL preference is read after hydration.
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [filterReady, setFilterReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedbackWorkingId, setFeedbackWorkingId] = useState<string | null>(null);
  const [savedWorkingId, setSavedWorkingId] = useState<string | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const importLocks = useRef(new Set<string>());
  const [importedRecipes, setImportedRecipes] = useState<Record<string, string>>({});

  useEffect(() => {
    const readFilterFromUrl = () => {
      const isSaved = new URLSearchParams(window.location.search).get('saved') === 'true';
      setFilter(isSaved ? 'saved' : 'all');
      setFilterReady(true);
    };
    readFilterFromUrl();
    window.addEventListener('popstate', readFilterFromUrl);
    return () => window.removeEventListener('popstate', readFilterFromUrl);
  }, []);

  useEffect(() => {
    if (!filterReady) return;
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setRows([]);
    setError(null);
    const load = async () => {
      try {
        const path = filter === 'saved' ? '/api/recipe-history?saved=true' : '/api/recipe-history';
        const result = await safeFetch<{ items: HistoryRow[] }>(path, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!current) return;
        if (!result.ok) throw new Error(result.error);
        setRows(result.data.items);
      } catch (cause) {
        if (!current || (cause instanceof Error && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar historial.');
      } finally {
        if (current) setLoading(false);
      }
    };

    void load();
    return () => {
      current = false;
      controller.abort();
    };
  }, [filter, filterReady]);

  const updateFilter = (nextFilter: HistoryFilter) => {
    const url = new URL(window.location.href);
    if (nextFilter === 'saved') {
      url.searchParams.set('saved', 'true');
    } else {
      url.searchParams.delete('saved');
    }
    window.history.replaceState(null, '', url);
    setFilter(nextFilter);
  };

  const deleteHistoryItem = async (id: string) => {
    setDeletingId(id);
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
      if (openId === id) setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la receta.');
    } finally {
      setDeletingId(null);
    }
  };

  const setFeedback = async (id: string, value: 'accepted' | 'discarded') => {
    setFeedbackWorkingId(id);
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
      setFeedbackWorkingId(null);
    }
  };

  const setSaved = async (entry: HistoryRow) => {
    const nextSaved = !entry.is_saved;
    setSavedWorkingId(entry.id);
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
        if (filter === 'saved' && !result.data.item.is_saved) {
          return prev.filter((row) => row.id !== entry.id);
        }
        return prev.map((row) =>
          row.id === entry.id ? { ...row, is_saved: result.data.item.is_saved } : row
        );
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la receta guardada.');
    } finally {
      setSavedWorkingId(null);
    }
  };

  const importToRecetario = async (entry: HistoryRow) => {
    if (importLocks.current.has(entry.id) || importedRecipes[entry.id]) return;
    const body = buildRecipeImportFromHistory({
      id: entry.id,
      title: entry.recipe_title,
      payload: entry.recipe_payload,
    });
    if (!body) {
      setError('Esta sugerencia antigua no tiene un formato compatible para importarla.');
      return;
    }
    importLocks.current.add(entry.id);
    setImportingId(entry.id);
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
      setImportedRecipes((current) => ({ ...current, [entry.id]: result.data.recipe.id }));
    } catch {
      setError('No pudimos llevar la receta a tu recetario. Podés intentarlo nuevamente.');
    } finally {
      importLocks.current.delete(entry.id);
      setImportingId(null);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
        <h1 className="text-3xl font-semibold">Historial de recetas</h1>
        <p className="mt-1 text-bistro-text-secondary">
          Tus ideas generadas. Marcar una idea para consultar no la guarda en Mi recetario; para
          tenerla siempre disponible, usá «Importar a Mi recetario».
        </p>

        <label className="mt-4 flex w-fit items-center gap-2 text-sm font-semibold text-bistro-text-secondary">
          Mostrar recetas
          <select
            value={filter}
            onChange={(event) => updateFilter(event.target.value as HistoryFilter)}
            className="rounded-xl border border-bistro-border bg-white px-3 py-1.5 text-sm font-medium text-bistro-text-primary"
          >
            <option value="all">Todas</option>
            <option value="saved">Marcadas para consultar</option>
          </select>
        </label>

        {loading ? (
          <p className="mt-4 text-sm text-bistro-text-secondary">Cargando historial...</p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {error}
          </p>
        ) : null}
        {!loading && rows.length === 0 ? (
          <p className="mt-4 text-sm text-bistro-text-secondary">
            {filter === 'saved'
              ? 'Aún no hay ideas marcadas para consultar.'
              : 'Aún no tienes recetas en el historial.'}
          </p>
        ) : null}

        <ul className="mt-4 grid gap-3">
          {rows.map((entry) => {
            const isOpen = openId === entry.id;
            return (
              <li
                key={entry.id}
                className="rounded-2xl border border-bistro-border bg-white/70 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-bistro-text-primary">
                    <span className="font-semibold">
                      {entry.recipe_title ?? humanCopy.suggestedRecipesForYou}
                    </span>{' '}
                    — {new Date(entry.created_at).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void setSaved(entry)}
                      aria-pressed={entry.is_saved}
                      disabled={savedWorkingId === entry.id}
                      className="rounded-xl border border-bistro-border bg-white px-3 py-1.5 text-sm font-semibold text-bistro-text-secondary disabled:opacity-70"
                    >
                      {entry.is_saved ? 'Quitar marca' : 'Marcar para consultar'}
                    </button>
                    {importedRecipes[entry.id] ? (
                      <Link
                        href={`/recipes/${importedRecipes[entry.id]}`}
                        className="inline-flex min-h-10 items-center rounded-xl bg-bistro-action-secondary px-3 py-2 text-sm font-semibold text-white"
                      >
                        Ver en Mi recetario
                      </Link>
                    ) : buildRecipeImportFromHistory({
                        id: entry.id,
                        title: entry.recipe_title,
                        payload: entry.recipe_payload,
                      }) ? (
                      <button
                        type="button"
                        onClick={() => void importToRecetario(entry)}
                        disabled={importingId === entry.id}
                        className="min-h-10 rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {importingId === entry.id ? 'Importando…' : 'Importar a Mi recetario'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void setFeedback(entry.id, 'accepted')}
                      disabled={feedbackWorkingId === entry.id}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${entry.user_feedback === 'accepted' ? 'border-bistro-action-secondary/40 bg-bistro-action-secondary/10 text-bistro-action-secondary' : 'border-bistro-border bg-white text-bistro-text-secondary'}`}
                    >
                      Me gustó
                    </button>
                    <button
                      type="button"
                      onClick={() => void setFeedback(entry.id, 'discarded')}
                      disabled={feedbackWorkingId === entry.id}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${entry.user_feedback === 'discarded' ? 'border-bistro-danger/30 bg-bistro-danger/10 text-bistro-danger' : 'border-bistro-border bg-white text-bistro-text-secondary'}`}
                    >
                      No me gustó
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenId(isOpen ? null : entry.id)}
                      className="rounded-xl border border-bistro-border bg-white px-3 py-1.5 text-sm font-semibold text-bistro-text-secondary"
                    >
                      {isOpen ? 'Ocultar' : 'Ver detalle'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteHistoryItem(entry.id)}
                      disabled={deletingId === entry.id}
                      className="rounded-xl border border-bistro-danger/30 bg-white px-3 py-1.5 text-sm font-semibold text-bistro-danger disabled:opacity-70"
                    >
                      {deletingId === entry.id ? 'Eliminando...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
                {isOpen ? (
                  <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-bistro-border bg-bistro-page p-3 text-sm text-bistro-text-primary">
                    {toPrettyPayload(entry.recipe_payload)}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <Link
            href="/recipes/search"
            className="text-sm font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
          >
            Ir a búsqueda de recetas
          </Link>
        </div>
      </section>
    </main>
  );
}
