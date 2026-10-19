'use client';

import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { safeFetch } from '@/lib/api';
import { buildRecipeImportPayload } from '@/lib/recipes/recipe-import';
import { getVisibleRecipeSources, type VisibleRecipeSource } from '@/lib/recipes/source-citations';
import {
  buildRecipeGenerationRequestPayload,
  buildTodayRecipeRequestFields,
} from '@/lib/recipes/today-handoff';
import type { Citation } from '@/services/types';

type RecipeGenerationResponse = {
  recipe: string;
  title: string;
  structuredIngredients?: StructuredRecipeIngredient[];
  ragContextUsed?: boolean;
  sources?: Citation[];
  recipeHistoryId?: string;
  servings?: number;
};

interface RecipeSearchResult {
  recipe: string;
  title: string;
  structuredIngredients: StructuredRecipeIngredient[];
  mode: 'free' | 'rag';
  ragContextUsed: boolean;
  sources: VisibleRecipeSource[];
  recipeHistoryId?: string;
  servings: number;
}

export default function RecipeSearchPage() {
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
  const [importedRecipe, setImportedRecipe] = useState<{ id: string; duplicates: number } | null>(null);
  const importLock = useRef(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setImportError(null);
    setImportedRecipe(null);
    importLock.current = false;
    setResult(null);

    try {
      const result = await safeFetch<RecipeGenerationResponse>('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(buildRecipeGenerationRequestPayload({
          mode,
          ingredients,
          recipeName,
          restrictions,
          todayFields,
        })),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo generar la receta.');
      }

      const data = result.data;

      const ragContextUsed = data.ragContextUsed ?? false;

      setResult({
        recipe: data.recipe,
        title: data.title,
        structuredIngredients: data.structuredIngredients ?? [],
        mode,
        ragContextUsed,
        sources: getVisibleRecipeSources(mode, ragContextUsed, data.sources ?? []),
        recipeHistoryId: data.recipeHistoryId,
        servings: data.servings ?? 4,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setLoading(false);
    }
  };

  const onImport = async () => {
    if (!result?.recipeHistoryId || importLock.current || importedRecipe) return;
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
        body: JSON.stringify(buildRecipeImportPayload({
          title: result.title,
          instructions: result.recipe,
          servings: result.servings,
          structuredIngredients: result.structuredIngredients,
          recipeHistoryId: result.recipeHistoryId,
        })),
      });
      if (!response.ok) throw new Error('No se pudo importar la receta al recetario.');
      setImportedRecipe({
        id: response.data.recipe.id,
        duplicates: response.data.warnings.duplicates.length,
      });
    } catch {
      importLock.current = false;
      setImportError('No se pudo importar la receta al recetario. Intentá nuevamente.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Buscar recetas</h1>
            <p className="text-[#6B5A50]">Generá recetas con IA a partir de tus ingredientes.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        <form onSubmit={onSubmit} className="grid gap-3">
          {todayFields ? (
            <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
              Nombre de receta (opcional)
              <input
                name="recipeName"
                value={recipeName}
                onChange={(e) => setRecipeName(e.target.value)}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
              />
            </label>
          ) : null}

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Quiero cocinar con (opcional; enfoca la solicitud, uno por línea)
            <textarea
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              rows={4}
              className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 outline-none"
            />
            {todayFields ? (
              <span className="font-normal">Estos ingredientes son sugerencias, no inventario confirmado.</span>
            ) : null}
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Restricciones (separadas por comas)
            <input
              value={restrictions}
              onChange={(e) => setRestrictions(e.target.value)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Modo
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'free' | 'rag')}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            >
              <option value="free">Libre</option>
              <option value="rag">Basado en biblioteca (RAG)</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Generando...' : 'Generar receta'}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="mt-6 rounded-xl border border-[#E8DDD2] bg-[#faf7f3] p-4">
            <h2 className="font-semibold">{result.title}</h2>
            <pre className="mt-2 whitespace-pre-wrap text-sm">{result.recipe}</pre>

            {result.recipeHistoryId ? (
              <div className="mt-4 grid gap-2">
                {!importedRecipe ? (
                  <button
                    type="button"
                    onClick={onImport}
                    disabled={importing}
                    className="h-11 w-fit rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
                  >
                    {importing ? 'Importando...' : 'Importar al recetario'}
                  </button>
                ) : (
                  <p role="status" className="text-sm text-green-800">
                    Receta importada.{' '}
                    <Link href={`/recipes/${importedRecipe.id}`} className="font-semibold underline">
                      Ver en el recetario
                    </Link>
                  </p>
                )}
                {importError ? <p role="alert" className="text-sm text-red-700">{importError}</p> : null}
                {importedRecipe && importedRecipe.duplicates > 0 ? (
                  <p role="status" className="text-sm text-[#6B5A50]">
                    Hay recetas con títulos similares en tu recetario; la receta igualmente fue importada.
                  </p>
                ) : null}
              </div>
            ) : null}

            {result.sources.length > 0 ? (
              <section className="mt-4" aria-labelledby="recipe-sources-heading">
                <h3 id="recipe-sources-heading" className="font-semibold">
                  Fuentes del recetario
                </h3>
                <ul className="mt-2 grid gap-2">
                  {result.sources.map((source) => (
                    <li
                      key={JSON.stringify([
                        source.sourceType,
                        source.sourceId,
                        source.pageNumber ?? null,
                        source.chunkId ?? null,
                      ])}
                      className="rounded-lg border border-[#E8DDD2] bg-white px-3 py-2 text-sm"
                    >
                      <p className="font-medium">{source.label}</p>
                      {source.title ? <p>{source.title}</p> : null}
                      {source.pageNumber ? <p>Página {source.pageNumber}</p> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : result.mode === 'rag' && (!result.ragContextUsed || result.sources.length === 0) ? (
              <p className="mt-4 text-sm text-[#6B5A50]">
                No se encontró contexto documental relevante para esta receta.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
