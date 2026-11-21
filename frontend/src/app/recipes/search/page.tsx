'use client';

import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { safeFetch } from '@/lib/api';
import { RecipeGenerateSchema } from '@/lib/validation';
import { buildRecipeImportPayload } from '@/lib/recipes/recipe-import';
import { getVisibleRecipeSources } from '@/lib/recipes/source-citations';
import {
  buildRecipeGenerationRequestPayload,
  buildTodayRecipeRequestFields,
} from '@/lib/recipes/today-handoff';
import type { Citation } from '@/services/types';
import {
  RecipeEditor,
  draftFromImport,
  payloadFromDraft,
  type Draft,
} from '../RecipeLibraryClient';

type RecipeGenerationResponse = {
  recipe: string;
  preparation?: string;
  title: string;
  structuredIngredients?: StructuredRecipeIngredient[];
  ragContextUsed?: boolean;
  sources?: Citation[];
  recipeHistoryId?: string;
  servings?: number;
};

interface RecipeSearchResult {
  recipe: string;
  preparation?: string;
  title: string;
  structuredIngredients: StructuredRecipeIngredient[];
  missingDocumentContext: boolean;
  recipeHistoryId?: string;
  servings: number;
}

function RecipeSearchContent() {
  const searchParams = useSearchParams();
  const todayFields = buildTodayRecipeRequestFields(new URLSearchParams(searchParams.toString()));
  const [ingredients, setIngredients] = useState(todayFields?.ingredients.join('\n') ?? '');
  const [recipeName, setRecipeName] = useState(todayFields?.recipeName ?? '');
  const [restrictions, setRestrictions] = useState('');
  const [mode, setMode] = useState<'free' | 'rag'>('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecipeSearchResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedRecipe, setImportedRecipe] = useState<{ id: string; duplicates: number } | null>(
    null
  );
  const importLock = useRef(false);
  const generationLock = useRef(false);
  const [reviewing, setReviewing] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (generationLock.current || importLock.current || reviewing) return;
    const payload = buildRecipeGenerationRequestPayload({
      mode,
      ingredients,
      recipeName,
      restrictions,
      todayFields,
    });
    if (!RecipeGenerateSchema.safeParse(payload).success) {
      setError(
        'Revisa el nombre, los ingredientes y las restricciones: máximo 30 ingredientes de 200 caracteres y 10 restricciones de 100 caracteres.'
      );
      return;
    }
    generationLock.current = true;
    setLoading(true);
    setError(null);
    setImportError(null);
    setImportedRecipe(null);
    setResult(null);

    try {
      const result = await safeFetch<RecipeGenerationResponse>('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo generar la receta.');
      }

      const data = result.data;

      const ragContextUsed = data.ragContextUsed ?? false;

      setResult({
        recipe: data.recipe,
        preparation: data.preparation,
        title: data.title,
        structuredIngredients: data.structuredIngredients ?? [],
        missingDocumentContext:
          mode === 'rag' &&
          getVisibleRecipeSources(mode, ragContextUsed, data.sources ?? []).length === 0,
        recipeHistoryId: data.recipeHistoryId,
        servings: data.servings ?? 4,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      generationLock.current = false;
      setLoading(false);
    }
  };

  const onImport = async (draft: Draft) => {
    if (
      !reviewing ||
      !result?.recipeHistoryId ||
      generationLock.current ||
      importLock.current ||
      importedRecipe
    )
      return;
    importLock.current = true;
    setImporting(true);
    setImportError(null);
    try {
      const response = await safeFetch<{
        recipe: { id: string };
        warnings: {
          duplicates: Array<{ recipeId: string; title: string; versionNumber: number }>;
        };
      }>('/api/recipes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payloadFromDraft(draft),
          sourceRecipeHistoryId: result.recipeHistoryId,
        }),
      });
      if (!response.ok) throw new Error('No se pudo importar la receta al recetario.');
      setImportedRecipe({
        id: response.data.recipe.id,
        duplicates: response.data.warnings.duplicates.length,
      });
      setReviewing(false);
    } catch {
      setImportError('No se pudo importar la receta al recetario. Intentá nuevamente.');
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="rounded-3xl bg-bistro-inverse px-5 py-4 text-white shadow-sm sm:px-8 sm:py-7">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-bistro-champagne">
              Tu asistente de cocina
            </p>
            <Link
              href="/recipes/history"
              className="inline-flex min-h-10 shrink-0 items-center rounded-xl border border-white/40 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Historial
            </Link>
          </div>
          <h1 className="mt-2 font-bistro-heading text-3xl font-semibold leading-tight sm:text-4xl">
            Buscar recetas
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-bistro-cream sm:text-base">
            Contame qué tenés o qué te gustaría cocinar.
          </p>
        </header>

        <section
          aria-label="Crear una receta con IA"
          className="mt-4 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6"
        >
          <p className="mb-3 text-sm leading-relaxed text-bistro-text-secondary">
            Podés usar tus ingredientes o pedir una idea sin indicar ninguno.
          </p>
          {todayFields?.recipeName ? (
            <p className="mb-3 rounded-lg bg-bistro-surface-warm px-3 py-2 text-sm font-semibold text-bistro-action-primary">
              Receta que elegiste: {todayFields.recipeName}
            </p>
          ) : null}

          <form onSubmit={onSubmit} className="grid gap-3">
            <label className="grid gap-2 text-sm font-semibold text-bistro-text-primary">
              Quiero cocinar con (opcional; uno por línea)
              <textarea
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
                rows={3}
                placeholder={'pollo\narroz\nzanahoria'}
                className="min-h-24 w-full resize-y rounded-xl border border-bistro-border bg-bistro-page px-3 py-3 text-base font-normal leading-relaxed text-bistro-text-primary placeholder:text-bistro-text-secondary focus-visible:outline-2 focus-visible:outline-bistro-action-primary"
              />
              {todayFields ? (
                <span className="text-xs font-normal text-bistro-text-secondary">
                  Ingredientes sugeridos para tu comida; todavía no se ha confirmado tu inventario.
                </span>
              ) : null}
            </label>

            <div className="grid gap-3 border-t border-bistro-border pt-3 sm:grid-cols-2">
              <div>
                <label className="grid gap-1.5 text-sm font-semibold text-bistro-text-primary">
                  Restricciones (separadas por comas)
                  <input
                    value={restrictions}
                    aria-describedby="recipe-restrictions-hint"
                    placeholder="Ej.: sin gluten, sin leche"
                    onChange={(e) => setRestrictions(e.target.value)}
                    className="min-h-12 w-full rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-base font-normal text-bistro-text-primary focus-visible:outline-2 focus-visible:outline-bistro-action-primary"
                  />
                </label>
                <p
                  id="recipe-restrictions-hint"
                  className="mt-1.5 text-xs leading-relaxed text-bistro-text-secondary"
                >
                  Separá con comas lo que querés evitar.
                </p>
              </div>

              <div>
                <label className="grid gap-1.5 text-sm font-semibold text-bistro-text-primary">
                  ¿De dónde tomamos ideas?
                  <select
                    aria-label="Modo"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'free' | 'rag')}
                    className="min-h-12 w-full rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-base font-normal text-bistro-text-primary focus-visible:outline-2 focus-visible:outline-bistro-action-primary"
                  >
                    <option value="free">Ideas de la IA</option>
                    <option value="rag">Libros de cocina (PDF)</option>
                  </select>
                </label>
                <p className="mt-1.5 text-xs leading-relaxed text-bistro-text-secondary">
                  {mode === 'rag'
                    ? 'Buscaremos información en los libros disponibles de la biblioteca.'
                    : 'La IA propondrá una receta según tu solicitud.'}
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || importing || reviewing}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-bistro-action-primary px-5 py-3 text-base font-bold text-white transition-colors hover:bg-bistro-action-primary-hover disabled:opacity-60 sm:w-fit"
            >
              <Sparkles aria-hidden="true" className="h-5 w-5" />
              {loading ? 'Generando...' : 'Generar receta'}
            </button>
            <details
              className="group rounded-xl border border-bistro-border bg-bistro-page"
              open={Boolean(todayFields?.recipeName)}
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-semibold text-bistro-action-primary [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                  Ponerle nombre a mi receta
                  {recipeName.trim() ? (
                    <span className="rounded-full bg-bistro-champagne px-2 py-0.5 text-xs text-bistro-text-primary">
                      Definido
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform group-open:rotate-90"
                />
              </summary>
              <div className="border-t border-bistro-border px-3 py-3">
                <label className="grid gap-1.5 text-sm font-semibold text-bistro-text-primary">
                  Nombre de receta (opcional)
                  <input
                    name="recipeName"
                    maxLength={200}
                    value={recipeName}
                    placeholder="Ej.: Pasta cremosa con verduras"
                    onChange={(e) => setRecipeName(e.target.value)}
                    className="min-h-12 w-full rounded-xl border border-bistro-border bg-white px-3 py-2 text-base font-normal text-bistro-text-primary focus-visible:outline-2 focus-visible:outline-bistro-action-primary"
                  />
                </label>
              </div>
            </details>
            <p className="-mt-2 text-xs leading-relaxed text-bistro-text-secondary">
              Antes de guardar, vas a poder revisar y corregir la receta que se genere.
            </p>
          </form>
        </section>

        {error ? (
          <p className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {error}
          </p>
        ) : null}

        {result ? (
          <div
            className="mt-5 min-w-0 rounded-2xl border border-bistro-border bg-white p-4 shadow-sm sm:p-6"
            role="region"
            aria-label="Receta generada"
          >
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-bistro-action-primary">
              <Sparkles aria-hidden="true" className="h-4 w-4" /> Propuesta de receta
            </div>
            <h2 className="font-bistro-heading text-2xl font-semibold leading-snug">
              {result.title}
            </h2>
            <p className="mt-2 text-xs text-bistro-text-secondary">
              Propuesta generada por IA: revisa que todos los ingredientes de la preparación estén
              en la lista, sus cantidades y las etiquetas antes de guardar o cocinar. No certifica
              ausencia de alérgenos ni de contaminación cruzada.
            </p>
            <pre className="mt-4 max-w-full whitespace-pre-wrap break-words rounded-xl bg-bistro-page p-4 font-sans text-sm leading-relaxed [overflow-wrap:anywhere]">
              {result.recipe}
            </pre>

            {result.recipeHistoryId ? (
              <div className="mt-4 grid gap-2">
                {!importedRecipe && reviewing ? (
                  <RecipeEditor
                    key={result.recipeHistoryId}
                    initial={draftFromImport(
                      buildRecipeImportPayload({
                        title: result.title,
                        instructions: result.recipe,
                        preparation: result.preparation,
                        servings: result.servings,
                        structuredIngredients: result.structuredIngredients,
                        recipeHistoryId: result.recipeHistoryId,
                      })
                    )}
                    saving={importing}
                    saveLabel="Confirmar y guardar"
                    onSave={(draft) => void onImport(draft)}
                    onCancel={() => {
                      if (!importLock.current) setReviewing(false);
                    }}
                  />
                ) : !importedRecipe ? (
                  <button
                    type="button"
                    onClick={() => setReviewing(true)}
                    disabled={importing}
                    className="min-h-12 w-full rounded-xl bg-bistro-action-primary px-4 py-3 font-semibold text-white disabled:opacity-60 sm:w-fit"
                  >
                    {importing ? 'Importando...' : 'Importar al recetario'}
                  </button>
                ) : (
                  <p role="status" className="text-sm text-bistro-success">
                    Receta importada.{' '}
                    <Link
                      href={`/recipes/${importedRecipe.id}`}
                      className="font-semibold underline"
                    >
                      Ver en el recetario
                    </Link>
                  </p>
                )}
                {importError ? (
                  <p role="alert" className="text-sm text-bistro-danger">
                    {importError}
                  </p>
                ) : null}
                {importedRecipe && importedRecipe.duplicates > 0 ? (
                  <p role="status" className="text-sm text-bistro-text-secondary">
                    Hay recetas con títulos similares en tu recetario; la receta igualmente fue
                    importada.
                  </p>
                ) : null}
              </div>
            ) : null}

            {result.missingDocumentContext ? (
              <p className="mt-4 text-sm text-bistro-text-secondary">
                No se encontró contexto documental relevante para esta receta.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

// The search-parameter consumer needs its own Suspense boundary for
// Next.js production prerendering and client navigation.
export default function RecipeSearchPage() {
  return (
    <Suspense
      fallback={
        <main
          className="min-h-screen bg-bistro-page p-6 text-bistro-text-secondary"
          aria-busy="true"
        >
          Cargando asistente de recetas…
        </main>
      }
    >
      <RecipeSearchContent />
    </Suspense>
  );
}
