'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import { scaleIngredients, type Recipe, type RecipeVersion } from '../recipe-ui';
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
  const [servings, setServings] = useState('');
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
    setError('');
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
    await load();
    return true;
  };
  const save = async (draft: Draft) => {
    setSaving(true);
    const saved = await mutate(
      `/api/recipes/${encodeURIComponent(id)}`,
      'PATCH',
      payloadFromDraft(draft)
    );
    setSaving(false);
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
  const scaled = scaleIngredients(
    version.ingredients,
    baseServings,
    Number(servings) || baseServings
  );
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <article className="mx-auto max-w-4xl rounded-3xl border border-bistro-border bg-white/85 p-5 premium-shadow">
        <Link
          href="/recipes"
          className="text-sm font-semibold text-bistro-action-primary underline"
        >
          Volver al recetario
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">{version.title}</h1>
            {recipe.category && (
              <p className="mt-1 text-bistro-text-secondary">{recipe.category}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {recipe.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEdit(!edit)} className="rounded-xl border px-3 py-2">
              {edit ? 'Cerrar edición' : 'Editar'}
            </button>
            <button
              onClick={() =>
                void mutate(`/api/recipes/${encodeURIComponent(id)}/archive`, 'PATCH', {
                  archived: !recipe.archived_at,
                })
              }
              className="rounded-xl border px-3 py-2"
            >
              {recipe.archived_at ? 'Desarchivar' : 'Archivar'}
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-bistro-danger/10 p-3 text-bistro-danger">
            {error}
          </p>
        )}
        {edit && (
          <section aria-label="Editar receta" className="mt-5 rounded-2xl border p-4">
            <RecipeEditor
              key={version.id}
              initial={draftFromRecipe(recipe)}
              onSave={(draft) => void save(draft)}
              onCancel={() => setEdit(false)}
              saving={saving}
            />
          </section>
        )}
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Ingredientes</h2>
          <p className="mt-2 text-sm">
            Porciones:{' '}
            <input
              aria-label="Porciones deseadas"
              type="number"
              min="1"
              className="w-24 rounded-lg border px-2 py-1"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </p>
          {scaled.partial && (
            <p className="mt-2 text-sm text-bistro-text-secondary">
              Algunas cantidades no se ajustaron porque no son numéricas o usan una unidad no
              reconocida.
            </p>
          )}
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {scaled.ingredients.map((item, i) => (
              <li key={`${item.name}-${i}`}>
                {[item.quantity, item.unit, item.name].filter(Boolean).join(' ')}
              </li>
            ))}
          </ul>
        </section>
        <section className="mt-6">
          <h2 className="text-xl font-semibold">Pasos y notas</h2>
          <p className="mt-2 whitespace-pre-wrap">
            {version.instructions || 'Sin pasos ni notas.'}
          </p>
        </section>
        <section className="mt-8">
          <h2 className="text-xl font-semibold">Historial de versiones</h2>
          {versions.length === 0 ? (
            <p className="mt-2">Aún no hay versiones.</p>
          ) : (
            <ol className="mt-3 grid gap-3">
              {versions.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-bistro-border p-3"
                >
                  <span>
                    Versión {item.version_number} · {item.title}
                  </span>
                  {item.id !== version.id && (
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            'Restaurar esta versión creará una nueva versión y no borrará las actuales. ¿Continuar?'
                          )
                        )
                          void mutate(`/api/recipes/${encodeURIComponent(id)}/restore`, 'POST', {
                            versionId: item.id,
                          });
                      }}
                      className="rounded-xl border px-3 py-2"
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
