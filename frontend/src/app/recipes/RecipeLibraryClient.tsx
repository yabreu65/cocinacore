'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Search, SlidersHorizontal, ChevronRight, Sparkles } from 'lucide-react';
import { safeFetch } from '@/lib/api';
import { CreatePersistentRecipeSchema } from '@/lib/validation';
import type { RecipeImportPayload } from '@/lib/recipes/recipe-import';
import {
  filterRecipes,
  ingredientSummary,
  type DuplicateRecipeCandidate,
  type Ingredient,
  type Recipe,
} from './recipe-ui';
import RecipePlanSelection from './RecipePlanSelection';
import CookingSessionPanel from './CookingSessionPanel';

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
const inputClass =
  'w-full rounded-xl border border-bistro-border bg-white px-3 py-2 text-bistro-text-primary';

export function RecipeEditor({
  initial = blank,
  onSave,
  onCancel,
  saving = false,
  saveLabel = 'Guardar',
}: {
  initial?: Draft;
  onSave: (draft: Draft) => void;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [validationError, setValidationError] = useState<string | null>(null);
  const update = (key: keyof Draft, value: string) => setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        if (
          draft.ingredients.some(
            (item) => !item.name.trim() && (item.quantity?.trim() || item.unit?.trim())
          )
        ) {
          setValidationError('Indica el nombre de cada ingrediente que tenga cantidad o unidad.');
          return;
        }
        const parsed = CreatePersistentRecipeSchema.safeParse(payloadFromDraft(draft));
        if (!parsed.success) {
          setValidationError(
            'Revisa el título, las porciones, los ingredientes, las notas y las etiquetas. Máximo 100 ingredientes y 20 etiquetas de 50 caracteres.'
          );
          return;
        }
        setValidationError(null);
        onSave(draft);
      }}
    >
      <fieldset disabled={saving} className="contents">
        <label className="grid gap-1 text-sm font-semibold">
          Título
          <input
            required
            maxLength={200}
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
            max="100"
            step="1"
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
                    maxLength={key === 'name' ? 200 : key === 'quantity' ? 100 : 50}
                    required={key === 'name' && Boolean(item.quantity?.trim() || item.unit?.trim())}
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
            disabled={saving || draft.ingredients.length >= 100}
            onClick={() =>
              setDraft((old) =>
                old.ingredients.length >= 100
                  ? old
                  : {
                      ...old,
                      ingredients: [...old.ingredients, { name: '', quantity: '', unit: '' }],
                    }
              )
            }
            className="w-fit rounded-xl border px-3 py-2 disabled:opacity-60"
          >
            Agregar ingrediente
          </button>
        </fieldset>
        <label className="grid gap-1 text-sm font-semibold">
          Pasos y notas
          <textarea
            aria-label="Pasos y notas"
            required
            maxLength={20_000}
            rows={6}
            className={inputClass}
            value={draft.instructions}
            onChange={(e) => update('instructions', e.target.value)}
          />
        </label>
        {validationError ? (
          <p role="alert" className="text-sm text-bistro-danger">
            {validationError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            disabled={saving}
            className="rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white"
          >
            {saveLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="rounded-xl border px-4 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/** Reuse the normal recipe editor for generated proposals before persistence. */
export function draftFromImport(input: RecipeImportPayload): Draft {
  return {
    title: input.title,
    category: '',
    tags: '',
    servings: String(input.servings),
    instructions: input.instructions,
    ingredients: input.ingredients.map((ingredient) => ({ ...ingredient })),
  };
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
  const saveLock = useRef(false);
  const selectedArchive = useRef(archive);
  const loadEpoch = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const currentArchive = selectedArchive.current;
    const epoch = ++loadEpoch.current;
    const isCurrent = () => mounted.current && loadEpoch.current === epoch;
    setLoading(true);
    setError('');
    try {
      const response = await safeFetch<{ items: Recipe[] }>(
        `/api/recipes?archived=${currentArchive}&limit=100&offset=0`,
        { credentials: 'same-origin' }
      );
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(response.error);
      setRecipes(response.data.items);
      setCategory((current) =>
        current === 'all' || response.data.items.some((item) => item.category === current)
          ? current
          : 'all'
      );
      setTag((current) =>
        current === 'all' || response.data.items.some((item) => item.tags.includes(current))
          ? current
          : 'all'
      );
    } catch (cause) {
      if (isCurrent())
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar la biblioteca.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadEpoch.current += 1;
    };
  }, [load]);
  const changeArchive = (next: typeof archive) => {
    if (selectedArchive.current === next) return;
    selectedArchive.current = next;
    setRecipes([]);
    setArchive(next);
    void load();
  };
  const categories = useMemo(
    () => [...new Set(recipes.map((r) => r.category).filter((v): v is string => Boolean(v)))],
    [recipes]
  );
  const tags = useMemo(() => [...new Set(recipes.flatMap((r) => r.tags))], [recipes]);
  const visible = filterRecipes(recipes, search, category, tag);
  const advancedFiltersActive = category !== 'all' || tag !== 'all';
  const create = async (draft: Draft) => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
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
      saveLock.current = false;
      setSaving(false);
    }
  };
  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6 md:py-8">
      <section className="mx-auto w-full max-w-6xl">
        <header className="rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-bistro-champagne">
              Tu biblioteca de cocina
            </p>
            <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
              Mi recetario
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream sm:text-base">
              Tus preparaciones favoritas, listas para volver a cocinar.
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                if (!saveLock.current) setCreating((current) => !current);
              }}
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-bistro-champagne px-4 py-3 text-sm font-bold text-bistro-text-primary transition hover:bg-white disabled:opacity-50"
            >
              Crear receta
            </button>
            <Link
              href="/recipes/history"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/40 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Historial
            </Link>
          </div>
        </header>
        {creating && (
          <section
            aria-label="Crear receta"
            className="mt-5 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6"
          >
            <h2 className="mb-4 font-bistro-heading text-xl font-semibold">Nueva receta</h2>
            <RecipeEditor
              onSave={(draft) => void create(draft)}
              onCancel={() => {
                if (!saveLock.current) setCreating(false);
              }}
              saving={saving}
            />
          </section>
        )}
        {duplicates.length > 0 && (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-3"
          >
            Hay recetas con títulos parecidos:{' '}
            {duplicates.map((duplicate) => duplicate.title).join(', ')}
          </p>
        )}
        <section
          aria-label="Buscar y filtrar recetas"
          className="mt-5 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-5"
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(190px,0.35fr)] sm:items-end">
            <label className="block min-w-0 text-sm font-semibold">
              Buscar en mis recetas
              <span className="relative mt-1.5 block">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-bistro-text-secondary"
                />
                <input
                  aria-label="Buscar recetas"
                  type="search"
                  placeholder="Receta o ingrediente…"
                  className="min-h-12 w-full rounded-xl border border-bistro-border bg-bistro-page py-3 pl-11 pr-3 text-base text-bistro-text-primary placeholder:text-bistro-text-secondary"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              Mostrar
              <select
                aria-label="Estado de recetas"
                className="min-h-12 w-full rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-base text-bistro-text-primary"
                value={archive}
                onChange={(e) => changeArchive(e.target.value as typeof archive)}
              >
                <option value="active">Activas</option>
                <option value="archived">Archivadas</option>
                <option value="all">Todas</option>
              </select>
            </label>
          </div>
          <details className="group mt-3 rounded-xl border border-bistro-border bg-bistro-page">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-semibold text-bistro-action-primary [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                Más filtros
                {advancedFiltersActive && (
                  <span className="rounded-full bg-bistro-champagne px-2 py-0.5 text-xs text-bistro-text-primary">
                    Aplicados
                  </span>
                )}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="h-4 w-4 transition-transform group-open:rotate-90"
              />
            </summary>
            <div className="grid gap-3 border-t border-bistro-border px-3 py-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-semibold">
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
              <label className="grid gap-1 text-sm font-semibold">
                Etiqueta
                <select className={inputClass} value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="all">Todas</option>
                  {tags.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </section>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bistro-heading text-2xl font-semibold">
              {archive === 'archived' ? 'Recetas archivadas' : 'Tus recetas'}
            </h2>
            <p role="status" className="mt-1 text-sm text-bistro-text-secondary">
              {loading
                ? 'Cargando recetas…'
                : error
                  ? 'No se pudieron cargar las recetas'
                  : visible.length +
                    (visible.length === 1 ? ' receta encontrada' : ' recetas encontradas')}
            </p>
          </div>
          <Link
            href="/recipes/search"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-bistro-action-primary px-4 py-2 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-surface-warm"
          >
            <Sparkles aria-hidden="true" className="h-4 w-4" />
            Buscar ideas con IA
          </Link>
        </div>
        {error && (
          <div role="alert" className="mt-5 rounded-xl bg-bistro-danger/10 p-3 text-bistro-danger">
            {error}{' '}
            <button onClick={() => void load()} className="ml-2 underline">
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="mt-4 rounded-2xl border border-dashed border-bistro-border bg-white px-5 py-8 text-center">
            <BookOpen aria-hidden="true" className="mx-auto h-9 w-9 text-bistro-action-primary" />
            <p className="mt-3 font-bistro-heading text-lg font-semibold">
              {search || advancedFiltersActive
                ? 'No encontramos coincidencias'
                : archive === 'archived'
                  ? 'Aún no hay recetas archivadas'
                  : 'Tu recetario empieza aquí'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-bistro-text-secondary">
              {search || advancedFiltersActive
                ? 'Probá otro ingrediente o cambiá los filtros.'
                : 'Podés crear una receta o descubrir ideas nuevas con el asistente.'}
            </p>
          </div>
        )}
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {!loading &&
            !error &&
            visible.map((recipe) => (
              <li
                key={recipe.id}
                className="flex min-w-0 flex-col rounded-2xl border border-bistro-border bg-white p-4 shadow-sm transition-colors hover:border-bistro-action-primary/40 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-bistro-surface-warm text-bistro-action-secondary">
                    <BookOpen aria-hidden="true" className="h-6 w-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={'/recipes/' + encodeURIComponent(recipe.id)}
                      className="block font-bistro-heading text-xl font-semibold leading-snug text-bistro-text-primary underline-offset-4 hover:underline"
                    >
                      {recipe.current_version.title}
                    </Link>
                    <p className="mt-1 text-sm text-bistro-text-secondary">
                      {recipe.current_version.servings
                        ? recipe.current_version.servings + ' porciones'
                        : 'Porciones sin definir'}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {recipe.archived_at && (
                    <span className="rounded-full bg-bistro-surface-warm px-2.5 py-1 text-xs font-semibold text-bistro-action-secondary">
                      Archivada
                    </span>
                  )}
                  {recipe.category && (
                    <span className="rounded-full bg-bistro-surface-warm px-2.5 py-1 text-xs font-semibold text-bistro-action-secondary">
                      {recipe.category}
                    </span>
                  )}
                  {recipe.tags.slice(0, 2).map((v) => (
                    <span
                      key={v}
                      className="rounded-full border border-bistro-border px-2.5 py-1 text-xs text-bistro-text-secondary"
                    >
                      {v}
                    </span>
                  ))}
                  {recipe.tags.length > 2 && (
                    <span className="rounded-full border border-bistro-border px-2.5 py-1 text-xs text-bistro-text-secondary">
                      {'+' + (recipe.tags.length - 2)}
                    </span>
                  )}
                </div>
                <div className="mt-3 min-w-0 flex-1 border-t border-bistro-border pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-bistro-text-secondary">
                    Ingredientes principales
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-bistro-text-secondary">
                    {ingredientSummary(recipe.current_version.ingredients)}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 items-start gap-2">
                  <Link
                    href={'/recipes/' + encodeURIComponent(recipe.id)}
                    aria-label={'Ver detalle de ' + recipe.current_version.title}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-bistro-action-primary-hover"
                  >
                    Ver receta
                  </Link>
                  {!recipe.archived_at ? (
                    <div className="[&>div]:mt-0 [&_button]:min-h-11 [&_button]:w-full">
                      <CookingSessionPanel
                        recipeId={recipe.id}
                        versionId={recipe.current_version.id}
                      />
                    </div>
                  ) : (
                    <span className="grid min-h-11 place-items-center text-xs text-bistro-text-secondary">
                      Solo lectura
                    </span>
                  )}
                </div>
                {!recipe.archived_at && (
                  <details className="group mt-3 rounded-xl bg-bistro-page">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-bistro-action-primary [&::-webkit-details-marker]:hidden">
                      Más opciones
                      <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform group-open:rotate-90"
                      />
                    </summary>
                    <div className="grid gap-3 border-t border-bistro-border p-3">
                      <Link
                        href={
                          '/app/cooking-intent?source=recipe&recipeId=' +
                          encodeURIComponent(recipe.id)
                        }
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-bistro-border bg-white px-3 py-2 text-center text-sm font-semibold text-bistro-action-primary"
                      >
                        Revisar preparación
                      </Link>
                      <RecipePlanSelection
                        recipeId={recipe.id}
                        versionId={recipe.current_version.id}
                      />
                    </div>
                  </details>
                )}
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
