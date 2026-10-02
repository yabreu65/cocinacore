'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { safeFetch } from '@/lib/api';
import { getVisibleRecipeSources, type VisibleRecipeSource } from '@/lib/recipes/source-citations';
import type { Citation } from '@/services/types';

type RecipeGenerationResponse = {
  recipe: string;
  title: string;
  structuredIngredients?: StructuredRecipeIngredient[];
  ragContextUsed?: boolean;
  sources?: Citation[];
};

interface RecipeSearchResult {
  recipe: string;
  title: string;
  structuredIngredients: StructuredRecipeIngredient[];
  mode: 'free' | 'rag';
  ragContextUsed: boolean;
  sources: VisibleRecipeSource[];
}

export default function RecipeSearchPage() {
  const [ingredients, setIngredients] = useState('');
  const [restrictions, setRestrictions] = useState('');
  const [mode, setMode] = useState<'free' | 'rag'>('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecipeSearchResult | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const result = await safeFetch<RecipeGenerationResponse>('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          mode,
          ingredients: ingredients.split('\n').map((i) => i.trim()).filter(Boolean),
          restrictions: {
            allergies: [],
            dietaryRules: restrictions.split(',').map((r) => r.trim()).filter(Boolean),
          },
          peopleCount: 4,
          culinaryProfile: {
            level: 'Intermedio',
            identity: [],
            preferred: [],
            avoid: restrictions.split(',').map((r) => r.trim()).filter(Boolean),
            goals: [],
          },
        }),
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
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido.');
    } finally {
      setLoading(false);
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
          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Quiero cocinar con (opcional; enfoca la solicitud, uno por línea)
            <textarea
              value={ingredients}
              onChange={(e) => setIngredients(e.target.value)}
              rows={4}
              className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 outline-none"
            />
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
