'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

type MatchChunkRow = {
  id: string;
  content: string;
  similarity: number | string | null;
  metadata?: { page_number?: number; book_title?: string };
};

type TermOption = {
  id: string;
  label: string;
  dimension: string;
};

type ErrorPayload = { error?: string };

async function readErrorPayload(response: Response, fallback: string): Promise<ErrorPayload> {
  const payload: unknown = await response.json().catch(() => ({ error: fallback }));
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const maybeError = (payload as { error?: unknown }).error;
    return { error: typeof maybeError === 'string' ? maybeError : fallback };
  }
  return { error: fallback };
}

function safeSimilarity(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export default function RecipeSearchPage() {
  const [ingredients, setIngredients] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<string>('');
  const [citations, setCitations] = useState<MatchChunkRow[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [selectedPreferred, setSelectedPreferred] = useState<string[]>([]);
  const [selectedAvoid, setSelectedAvoid] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [level, setLevel] = useState<string>('');

  const normalizedIngredients = useMemo(
    () => ingredients.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
    [ingredients],
  );

  useEffect(() => {
    const loadTerms = async () => {
      const supabase = getSupabaseBrowserClient();
      const [{ data: termsData }, { data: dimensionsData }] = await Promise.all([
        supabase
        .from('culinary_terms')
        .select('id,label,dimension_id')
        .eq('is_active', true)
        .limit(120),
        supabase.from('culinary_dimensions').select('id,key'),
      ]);

      const rows = (termsData ?? []) as Array<{ id: string; label: string; dimension_id: string }>;
      const dimensionById = new Map((dimensionsData ?? []).map((row) => [row.id, row.key]));
      setTerms(
        rows.map((row) => ({
          id: row.id,
          label: row.label,
          dimension: dimensionById.get(row.dimension_id) ?? '',
        })),
      );
    };
    void loadTerms();
  }, []);

  const preferredOptions = terms.filter((t) => ['regional_cuisine', 'culinary_style', 'technique'].includes(t.dimension));
  const avoidOptions = terms.filter((t) => ['food_goal'].includes(t.dimension));
  const goalOptions = terms.filter((t) => ['food_goal'].includes(t.dimension));
  const levelOptions = terms.filter((t) => t.dimension === 'skill_level');

  const toggle = (setFn: React.Dispatch<React.SetStateAction<string[]>>, value: string) => {
    setFn((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setRecipe('');
    setCitations([]);

    try {
      const supabase = getSupabaseBrowserClient();
      const query = `Receta con ingredientes: ${normalizedIngredients.join(', ') || 'libre'}. Preferencias: ${selectedPreferred.join(', ') || 'sin preferencia'}.`;

      const embedRes = await fetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [query] }),
      });

      if (!embedRes.ok) {
        const payload = await readErrorPayload(embedRes, 'No se pudo crear embedding.');
        throw new Error(payload.error ?? 'No se pudo crear embedding.');
      }

      const embedPayload = (await embedRes.json()) as { embeddings: number[][] };
      const queryEmbedding = embedPayload.embeddings[0];

      const { data: chunkRows, error: rpcErr } = await supabase.rpc('match_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.35,
        match_count: 8,
        filter_tenant_id: null,
      });

      if (rpcErr) throw rpcErr;

      const safeChunks = ((chunkRows ?? []) as MatchChunkRow[])
        .filter((row) => row.content)
        .sort((a, b) => safeSimilarity(b.similarity) - safeSimilarity(a.similarity));

      const recipeRes = await fetch('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: normalizedIngredients,
          chunks: safeChunks.map((row) => row.content),
          culinaryProfile: {
            preferred: selectedPreferred,
            avoid: selectedAvoid,
            goals: selectedGoals,
            level: level || null,
            identity: [],
          },
        }),
      });

      if (!recipeRes.ok) {
        const payload = await readErrorPayload(recipeRes, 'No se pudo generar receta.');
        throw new Error(payload.error ?? 'No se pudo generar receta.');
      }

      const recipePayload = (await recipeRes.json()) as { recipe: string };
      setRecipe(recipePayload.recipe);
      setCitations(safeChunks.slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando receta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Búsqueda de recetas</h1>
            <p className="text-[#6B5A50]">RAG + perfil culinario + filtros inteligentes.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">Volver</Link>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3">
          <label htmlFor="ingredients" className="text-sm font-semibold text-[#6B5A50]">Ingredientes (coma)</label>
          <input id="ingredients" value={ingredients} onChange={(event) => setIngredients(event.target.value)} placeholder="tomate, cebolla" className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none" />

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-[#6B5A50]">Preferencias</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {preferredOptions.slice(0, 14).map((option) => (
                  <button key={option.id} type="button" onClick={() => toggle(setSelectedPreferred, option.label)} className={`rounded-full border px-2.5 py-1 text-xs ${selectedPreferred.includes(option.label) ? 'border-[#6D4AFF]/50 bg-[#6D4AFF]/10 text-[#6D4AFF]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}>{option.label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#6B5A50]">Evitar</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {avoidOptions.slice(0, 10).map((option) => (
                  <button key={option.id} type="button" onClick={() => toggle(setSelectedAvoid, option.label)} className={`rounded-full border px-2.5 py-1 text-xs ${selectedAvoid.includes(option.label) ? 'border-red-300 bg-red-50 text-red-700' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}>{option.label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-[#6B5A50]">Objetivo</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {goalOptions.slice(0, 10).map((option) => (
                  <button key={option.id} type="button" onClick={() => toggle(setSelectedGoals, option.label)} className={`rounded-full border px-2.5 py-1 text-xs ${selectedGoals.includes(option.label) ? 'border-[#567A3B]/40 bg-[#567A3B]/10 text-[#567A3B]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}>{option.label}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-semibold text-[#6B5A50]">Nivel culinario</label>
              <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm">
                <option value="">Sin preferencia</option>
                {levelOptions.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={loading} className="h-11 rounded-xl bg-[#C56A1A] font-semibold text-white disabled:opacity-60">
            {loading ? 'Generando...' : 'Generar receta'}
          </button>
        </form>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        {recipe ? (
          <section className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-xl font-semibold">Receta</h2>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-[#3B2F26]">{recipe}</pre>
            <h3 className="mt-3 text-sm font-semibold text-[#6B5A50]">Citas</h3>
            <ul className="mt-1 space-y-1 text-xs text-[#6B5A50]">
              {citations.map((row) => (
                <li key={row.id}>{row.metadata?.book_title ?? 'Documento'} · pág {row.metadata?.page_number ?? '-'} · sim {safeSimilarity(row.similarity).toFixed(3)}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
