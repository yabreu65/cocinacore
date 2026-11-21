'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChefHat, Clock3, Pencil, UsersRound } from 'lucide-react';
import { safeFetch } from '@/lib/api';
import { recipePortionCost, scaleIngredients, type Recipe, type RecipeVersion } from '../recipe-ui';
import type { InventoryCostLot } from '@/lib/inventory/inventory-costing';
import { isInventoryCurrency, type InventoryCurrency } from '@/lib/inventory/inventory-price';
import {
  draftFromRecipe,
  payloadFromDraft,
  RecipeEditor,
  type Draft,
} from '../RecipeLibraryClient';

export default function RecipeDetailClient({ id }: { id: string }) {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const mutationLock = useRef(false);
  const [servings, setServings] = useState('');
  const [costSource, setCostSource] = useState<{
    recipeId: string;
    lots: InventoryCostLot[];
    currency: InventoryCurrency | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setCostSource(null);
    void Promise.all([
      safeFetch<{ items: InventoryCostLot[] }>('/api/inventory', {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
      safeFetch<{ currency: InventoryCurrency | null }>('/api/inventory/currency', {
        credentials: 'same-origin',
        cache: 'no-store',
      }),
    ])
      .then(([inventory, settings]) => {
        if (active && inventory.ok && settings.ok && Array.isArray(inventory.data.items)) {
          setCostSource({
            recipeId: id,
            lots: inventory.data.items,
            currency: isInventoryCurrency(settings.data.currency) ? settings.data.currency : null,
          });
        }
      })
      .catch(() => {
        /* The recipe remains usable without cost information. */
      });
    return () => {
      active = false;
    };
  }, [id]);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [detail, history] = await Promise.all([
        safeFetch<{ recipe: Recipe }>(`/api/recipes/${encodeURIComponent(id)}`, {
          credentials: 'same-origin',
        }),
        safeFetch<{ versions: RecipeVersion[] }>(
          `/api/recipes/${encodeURIComponent(id)}/versions`,
          { credentials: 'same-origin' }
        ),
      ]);
      if (!detail.ok) throw new Error(detail.error);
      if (!history.ok) throw new Error(history.error);
      setRecipe(detail.data.recipe);
      setVersions(history.data.versions);
      setServings(String(detail.data.recipe.current_version.servings ?? ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la receta.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const mutate = async (url: string, method: string, body?: unknown) => {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await safeFetch<{ recipe: Recipe; version?: RecipeVersion }>(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      // The successful write already returns the authoritative recipe. Keep
      // it visible even when the subsequent history/detail refresh fails.
      const updated = result.data.recipe;
      setRecipe(updated);
      setServings(String(updated.current_version.servings ?? ''));
      setVersions((current) => [
        updated.current_version,
        ...current.filter((item) => item.id !== updated.current_version.id),
      ]);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la receta.');
      return false;
    } finally {
      mutationLock.current = false;
      setSaving(false);
    }
  };
  const save = async (draft: Draft) => {
    const saved = await mutate(
      `/api/recipes/${encodeURIComponent(id)}`,
      'PATCH',
      payloadFromDraft(draft)
    );
    if (saved) setEdit(false);
  };
  if (loading)
    return (
      <main className="texture-paper min-h-screen bg-bistro-page p-6" role="status">
        Cargando receta…
      </main>
    );
  if (error && !recipe)
    return (
      <main className="texture-paper min-h-screen bg-bistro-page p-6">
        <p role="alert">{error}</p>
        <button onClick={() => void load()} className="underline">
          Reintentar
        </button>
        <p>
          <Link href="/recipes">Volver al recetario</Link>
        </p>
      </main>
    );
  if (!recipe)
    return (
      <main className="texture-paper min-h-screen bg-bistro-page p-6">
        Receta no encontrada. <Link href="/recipes">Volver al recetario</Link>
      </main>
    );
  const version = recipe.current_version;
  const baseServings = version.servings ?? 0;
  const targetServings = Number(servings);
  const scaled = scaleIngredients(version.ingredients, baseServings, targetServings);
  const source = costSource?.recipeId === id ? costSource : null;
  const cost =
    source && version.ingredients.length > 0
      ? recipePortionCost(
          version.ingredients,
          baseServings,
          targetServings,
          source.lots,
          source.currency
        )
      : null;
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6 md:py-8">
      <article className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <Link
            href="/recipes"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/40 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Volver al recetario
          </Link>
          <div className="mt-4">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-bistro-champagne">
              <ChefHat aria-hidden="true" className="h-4 w-4" />
              Tu cocina
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {recipe.category && (
                <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                  {recipe.category}
                </span>
              )}
              {recipe.archived_at && (
                <span className="rounded-full border border-bistro-champagne px-3 py-1 text-xs font-semibold text-bistro-champagne">
                  Archivada
                </span>
              )}
              {recipe.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/25 px-3 py-1 text-xs text-bistro-cream"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h1 className="mt-3 break-words font-bistro-heading text-3xl font-semibold leading-tight sm:text-4xl">
              {version.title}
            </h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-bistro-cream">
              <UsersRound aria-hidden="true" className="h-4 w-4" />
              {baseServings > 0
                ? String(baseServings) +
                  (baseServings === 1 ? ' porción original' : ' porciones originales')
                : 'Porciones por definir'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {!recipe.archived_at && (
                <Link
                  href={'/app/cooking-intent?source=recipe&recipeId=' + encodeURIComponent(id)}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-bistro-champagne px-4 py-3 text-sm font-bold text-bistro-text-primary transition hover:bg-white sm:flex-none"
                >
                  <ChefHat aria-hidden="true" className="h-5 w-5" />
                  Cocinar ahora
                </Link>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  if (!mutationLock.current) setEdit((current) => !current);
                }}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/40 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60 sm:flex-none"
              >
                <Pencil aria-hidden="true" className="h-4 w-4" />
                {edit ? 'Cerrar edición' : 'Editar'}
              </button>
              <button
                disabled={saving || edit}
                onClick={() =>
                  void mutate(`/api/recipes/${encodeURIComponent(id)}/archive`, 'PATCH', {
                    archived: !recipe.archived_at,
                  })
                }
                className="inline-flex min-h-12 items-center rounded-xl border border-white/40 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                {recipe.archived_at ? 'Desarchivar' : 'Archivar'}
              </button>
            </div>
          </div>
        </header>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-bistro-danger/10 p-3 text-bistro-danger">
            {error}{' '}
            <button
              type="button"
              disabled={saving || edit}
              onClick={() => void load()}
              className="ml-2 underline"
            >
              Reintentar carga
            </button>
          </p>
        )}
        {edit && (
          <section aria-label="Editar receta" className="mt-5 rounded-2xl border p-4">
            <RecipeEditor
              key={version.id}
              initial={draftFromRecipe(recipe)}
              onSave={(draft) => void save(draft)}
              onCancel={() => {
                if (!mutationLock.current) setEdit(false);
              }}
              saving={saving}
            />
          </section>
        )}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section
            aria-labelledby="recipe-ingredients-heading"
            className="min-w-0 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-bistro-action-primary">
                  Lo que vas a necesitar
                </p>
                <h2
                  id="recipe-ingredients-heading"
                  className="mt-1 font-bistro-heading text-2xl font-semibold"
                >
                  Ingredientes
                </h2>
              </div>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-bistro-border bg-bistro-page px-3 py-1.5 text-sm font-semibold">
                Porciones
                <input
                  aria-label="Porciones deseadas"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  className="h-9 w-14 rounded-lg border border-bistro-border bg-white px-1 text-center text-base"
                  value={servings}
                  onChange={(e) => setServings(e.target.value)}
                />
              </label>
            </div>
            {scaled.partial && (
              <p className="mt-3 rounded-xl bg-bistro-surface-warm p-3 text-sm leading-relaxed text-bistro-text-secondary">
                Algunas cantidades conservan sus valores originales. Revisá las porciones y las
                unidades antes de cocinar.
              </p>
            )}
            {scaled.ingredients.length > 0 ? (
              <ul
                aria-label="Ingredientes de la receta"
                className="mt-4 divide-y divide-bistro-border"
              >
                {scaled.ingredients.map((item, i) => (
                  <li
                    key={[item.name, i].join('-')}
                    className="flex min-w-0 items-start gap-3 py-3 text-sm leading-relaxed sm:text-base"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-bistro-action-primary"
                    />
                    <span className="min-w-0 flex-1 break-words">{item.name}</span>
                    {(item.quantity || item.unit) && (
                      <span className="max-w-[45%] shrink-0 break-words text-right font-semibold text-bistro-action-secondary">
                        {[item.quantity, item.unit].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-bistro-text-secondary">
                No se registraron ingredientes.
              </p>
            )}
            <p
              className="mt-4 rounded-xl bg-bistro-surface-warm p-3 text-sm leading-relaxed"
              role="status"
            >
              <strong className="text-bistro-action-primary">Costo estimado: </strong>
              {cost && cost.amount !== null && cost.currency
                ? `${cost.amount} ${cost.currency}${cost.status === 'partial' ? ' (parcial; faltan cantidades o precios)' : ''}`
                : 'No disponible; revisá las porciones, los precios y la moneda del inventario.'}
            </p>
          </section>
          <section
            aria-label="Instrucciones de la receta"
            className="min-w-0 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6"
          >
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-bistro-action-primary">
              <Clock3 aria-hidden="true" className="h-4 w-4" /> A cocinar
            </p>
            <h2
              id="recipe-steps-heading"
              className="mt-1 font-bistro-heading text-2xl font-semibold"
            >
              Pasos y notas
            </h2>
            <p className="mt-4 whitespace-pre-wrap break-words text-base leading-8 [overflow-wrap:anywhere]">
              {version.instructions || 'Sin pasos ni notas.'}
            </p>
          </section>
        </div>
        <section className="mt-5 min-w-0 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bistro-heading text-xl font-semibold">Historial de versiones</h2>
            <span className="rounded-full bg-bistro-surface-warm px-3 py-1 text-xs font-semibold text-bistro-action-primary">
              {versions.length} {versions.length === 1 ? 'versión' : 'versiones'}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-bistro-text-secondary">
            Consultá las versiones anteriores y restauralas sin borrar las actuales.
          </p>
          {versions.length === 0 ? (
            <p className="mt-2">Aún no hay versiones.</p>
          ) : (
            <ol className="mt-4 grid gap-3">
              {versions.map((item) => (
                <li
                  key={item.id}
                  className="flex min-w-0 flex-col gap-3 rounded-xl border border-bistro-border bg-bistro-page p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
                >
                  <span className="min-w-0 break-words text-sm font-semibold">
                    Versión {item.version_number} · {item.title}
                    {item.source_recipe_history_id ? (
                      <span className="block text-xs text-bistro-text-secondary">
                        Vinculada a una propuesta del historial.{' '}
                        <Link href="/recipes/history" className="underline">
                          Consultar historial original
                        </Link>
                      </span>
                    ) : null}
                  </span>
                  {item.id !== version.id && (
                    <button
                      disabled={saving || edit}
                      onClick={() => {
                        if (mutationLock.current) return;
                        if (
                          window.confirm(
                            'Restaurar esta versión creará una nueva versión y no borrará las actuales. ¿Continuar?'
                          )
                        )
                          void mutate(`/api/recipes/${encodeURIComponent(id)}/restore`, 'POST', {
                            versionId: item.id,
                          });
                      }}
                      className="min-h-11 shrink-0 rounded-xl border border-bistro-action-primary px-3 py-2 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-surface-warm disabled:opacity-60"
                    >
                      Restaurar como nueva versión
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      </article>
    </main>
  );
}
