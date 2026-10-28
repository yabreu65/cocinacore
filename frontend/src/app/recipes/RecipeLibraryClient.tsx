'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import {
  filterRecipes,
  ingredientSummary,
  type DuplicateRecipeCandidate,
  type Ingredient,
  type Recipe,
} from './recipe-ui';

export type Draft = {
  title: string;
  category: string;
  tags: string;
  servings: string;
  instructions: string;
  ingredients: Ingredient[];
};
const blank: Draft = {
  title: '',
  category: '',
  tags: '',
  servings: '',
  instructions: '',
  ingredients: [{ name: '', quantity: '', unit: '' }],
};
const inputClass = 'w-full rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-[#3B2F26]';

export function RecipeEditor({
  initial = blank,
  onSave,
  onCancel,
  saving = false,
}: {
  initial?: Draft;
  onSave: (draft: Draft) => void;
  onCancel?: () => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const update = (key: keyof Draft, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <label className="grid gap-1 text-sm font-semibold">
        Título
        <input
          required
          aria-label="Título"
          className={inputClass}
          value={draft.title}
          onChange={(e) => update('title', e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Categoría
        <input
          className={inputClass}
          value={draft.category}
          onChange={(e) => update('category', e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Etiquetas, separadas por comas
        <input
          className={inputClass}
          value={draft.tags}
          onChange={(e) => update('tags', e.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Porciones
        <input
          type="number"
          min="1"
          className={inputClass}
          value={draft.servings}
          onChange={(e) => update('servings', e.target.value)}
        />
      </label>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Ingredientes</legend>
        {draft.ingredients.map((item, index) => (
          <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            {(['name', 'quantity', 'unit'] as const).map((key) => (
              <label key={key} className="grid gap-1 text-xs font-semibold">
                {key === 'name' ? 'Nombre' : key === 'quantity' ? 'Cantidad' : 'Unidad'}
                <input
                  aria-label={`${key === 'name' ? 'Nombre' : key === 'quantity' ? 'Cantidad' : 'Unidad'} del ingrediente ${index + 1}`}
                  className={inputClass}
                  value={item[key] ?? ''}
                  onChange={(e) =>
                    setDraft((old) => ({
                      ...old,
                      ingredients: old.ingredients.map((row, i) =>
                        i === index ? { ...row, [key]: e.target.value } : row
                      ),
                    }))
                  }
                />
              </label>
            ))}
            <button
              type="button"
              aria-label={`Quitar ingrediente ${index + 1}`}
              onClick={() =>
                setDraft((old) => ({
                  ...old,
                  ingredients: old.ingredients.filter((_, i) => i !== index),
                }))
              }
              className="self-end rounded-xl border px-3 py-2"
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setDraft((old) => ({
              ...old,
              ingredients: [...old.ingredients, { name: '', quantity: '', unit: '' }],
            }))
          }
          className="w-fit rounded-xl border px-3 py-2"
        >
          Agregar ingrediente
        </button>
      </fieldset>
      <label className="grid gap-1 text-sm font-semibold">
        Pasos y notas
        <textarea
          aria-label="Pasos y notas"
          rows={6}
          className={inputClass}
          value={draft.instructions}
          onChange={(e) => update('instructions', e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          disabled={saving}
          className="rounded-xl bg-[#C56A1A] px-4 py-2 font-semibold text-white"
        >
          Guardar
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-xl border px-4 py-2">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export function draftFromRecipe(recipe: Recipe): Draft {
  const v = recipe.current_version;
  return {
    title: v.title,
    category: recipe.category ?? '',
    tags: recipe.tags.join(', '),
    servings: v.servings?.toString() ?? '',
    instructions: v.instructions,
    ingredients: v.ingredients.map((item) => ({ ...item })),
  };
}
export function payloadFromDraft(draft: Draft) {
  return {
    title: draft.title.trim(),
    category: draft.category.trim() || undefined,
    tags: draft.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    servings: draft.servings ? Number(draft.servings) : undefined,
    instructions: draft.instructions,
    ingredients: draft.ingredients
      .filter((item) => item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        quantity: item.quantity?.trim() || undefined,
        unit: item.unit?.trim() || undefined,
      })),
  };
}

export default function RecipeLibraryClient() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [archive, setArchive] = useState<'active' | 'archived' | 'all'>('active');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState('all');
  const [creating, setCreating] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateRecipeCandidate[]>([]);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await safeFetch<{ items: Recipe[] }>(
        `/api/recipes?archived=${archive}&limit=100&offset=0`,
        { credentials: 'same-origin' }
      );
      if (!response.ok) throw new Error(response.error);
      setRecipes(response.data.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la biblioteca.');
    } finally {
      setLoading(false);
    }
  }, [archive]);
  useEffect(() => {
    void load();
  }, [load]);
  const categories = useMemo(
    () => [...new Set(recipes.map((r) => r.category).filter((v): v is string => Boolean(v)))],
    [recipes]
  );
  const tags = useMemo(() => [...new Set(recipes.flatMap((r) => r.tags))], [recipes]);
  const visible = filterRecipes(recipes, search, category, tag);
  const create = async (draft: Draft) => {
    setSaving(true);
    try {
      const result = await safeFetch<{
        recipe: Recipe;
        warnings: { duplicates: DuplicateRecipeCandidate[] };
      }>('/api/recipes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFromDraft(draft)),
      });
      if (!result.ok) throw new Error(result.error);
      setDuplicates(result.data.warnings.duplicates);
      setCreating(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la receta.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto max-w-6xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Mi recetario</h1>
            <p className="mt-1 text-[#6B5A50]">Tus recetas, organizadas en un solo lugar.</p>
          </div>
          <button
            onClick={() => setCreating(!creating)}
            className="rounded-full bg-[#C56A1A] px-5 py-2.5 font-bold text-white"
          >
            Crear receta
          </button>
        </div>
        {creating && (
          <section
            aria-label="Crear receta"
            className="mt-5 rounded-2xl border border-[#E8DDD2] bg-white p-4"
          >
            <RecipeEditor
              onSave={(draft) => void create(draft)}
              onCancel={() => setCreating(false)}
              saving={saving}
            />
          </section>
        )}
        {duplicates.length > 0 && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
            Hay recetas con títulos parecidos:{' '}
            {duplicates.map((duplicate) => duplicate.title).join(', ')}
          </p>
        )}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold">
            Buscar
            <input
              aria-label="Buscar recetas"
              className={inputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="text-sm font-semibold">
            Mostrar
            <select
              aria-label="Estado de recetas"
              className={inputClass}
              value={archive}
              onChange={(e) => setArchive(e.target.value as typeof archive)}
            >
              <option value="active">Activas</option>
              <option value="archived">Archivadas</option>
              <option value="all">Todas</option>
            </select>
          </label>
          <label className="text-sm font-semibold">
            Categoría
            <select
              className={inputClass}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">Todas</option>
              {categories.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold">
            Etiqueta
            <select className={inputClass} value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="all">Todas</option>
              {tags.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        {loading && (
          <p role="status" className="mt-5">
            Cargando recetas…
          </p>
        )}
        {error && (
          <div role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-red-800">
            {error}{' '}
            <button onClick={() => void load()} className="ml-2 underline">
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="mt-5">No encontramos recetas con esos filtros.</p>
        )}
        <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((recipe) => (
            <li key={recipe.id} className="rounded-2xl border border-[#E8DDD2] bg-white p-4">
              <Link
                href={`/recipes/${encodeURIComponent(recipe.id)}`}
                className="text-lg font-semibold text-[#6B3510] underline-offset-2 hover:underline"
              >
                {recipe.current_version.title}
              </Link>
              {!recipe.archived_at && (
                <Link
                  href={`/app/cooking-intent?source=recipe&recipeId=${encodeURIComponent(recipe.id)}`}
                  className="mt-2 block text-sm font-semibold text-[#8C4712] underline underline-offset-2"
                >
                  Revisar preparación
                </Link>
              )}
              {recipe.archived_at && (
                <span className="ml-2 rounded-full bg-[#F4E8DD] px-2 py-1 text-xs">Archivada</span>
              )}
              <p className="mt-2 text-sm text-[#6B5A50]">
                {recipe.current_version.servings ?? '—'} porciones
              </p>
              <p className="mt-1 text-sm">
                {ingredientSummary(recipe.current_version.ingredients)}
              </p>
              <div className="mt-3 flex flex-wrap gap-1">
                {recipe.category && (
                  <span className="rounded-full bg-[#F4E8DD] px-2 py-1 text-xs">
                    {recipe.category}
                  </span>
                )}
                {recipe.tags.map((v) => (
                  <span key={v} className="rounded-full bg-[#F4E8DD] px-2 py-1 text-xs">
                    {v}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
