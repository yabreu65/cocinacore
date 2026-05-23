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

type TaxonomySelectionConfig = {
  title: string;
  subtitle: string;
  max: number;
  options: string[];
};

const REGIONAL_CONFIG: TaxonomySelectionConfig = {
  title: 'Cocina regional',
  subtitle: 'Explora sabores y tradiciones culinarias.',
  max: 2,
  options: ['Italiana', 'Latina', 'Asiática', 'Mexicana', 'Mediterránea', 'Árabe'],
};

const STYLE_CONFIG: TaxonomySelectionConfig = {
  title: 'Estilo culinario',
  subtitle: 'Selecciona el estilo de comida ideal.',
  max: 2,
  options: ['Casera', 'Gourmet', 'Rápida', 'Comfort food', 'Parrilla', 'Saludable', 'Vegana', 'Postres'],
};

const GOAL_CONFIG: TaxonomySelectionConfig = {
  title: 'Objetivo / contexto',
  subtitle: 'Adapta recetas a tu contexto.',
  max: 3,
  options: ['Familiar', 'Meal prep', 'Fitness', 'Infantil', 'Cena rápida', 'Aprender cocina'],
};

const AVOID_CONFIG: TaxonomySelectionConfig = {
  title: 'Restricciones / evitar',
  subtitle: 'Personaliza recetas según tus necesidades.',
  max: 6,
  options: ['Sin gluten', 'Sin lactosa', 'Keto', 'Frutos secos', 'Mariscos', 'Vegetariano'],
};

const STORAGE_KEY = 'cocinacore_recipe_search_filters_v1';

const QUICK_TEMPLATES: Array<{
  label: string;
  ingredients: string;
  regional: string[];
  style: string[];
  goals: string[];
  avoid: string[];
  level: string;
}> = [
  {
    label: 'Cena familiar en 20 min',
    ingredients: 'pollo, tomate, cebolla, arroz',
    regional: ['Latina'],
    style: ['Casera', 'Rápida'],
    goals: ['Familiar', 'Cena rápida'],
    avoid: [],
    level: 'Principiante',
  },
  {
    label: 'Meal prep semanal',
    ingredients: 'pollo, arroz, zanahoria, brócoli',
    regional: ['Mediterránea'],
    style: ['Saludable'],
    goals: ['Meal prep', 'Fitness'],
    avoid: [],
    level: 'Intermedio',
  },
];

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

function SelectionCard(props: {
  title: string;
  subtitle: string;
  selected: string[];
  options: string[];
  onToggle: (value: string) => void;
  activeClassName: string;
  idleClassName: string;
}) {
  const { title, subtitle, selected, options, onToggle, activeClassName, idleClassName } = props;
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-[#6B5A50]">{subtitle}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              selected.includes(option) ? activeClassName : idleClassName
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </article>
  );
}

export default function RecipeSearchPage() {
  const [ingredients, setIngredients] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<string>('');
  const [citations, setCitations] = useState<MatchChunkRow[]>([]);
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [selectedRegional, setSelectedRegional] = useState<string[]>([]);
  const [selectedStyle, setSelectedStyle] = useState<string[]>([]);
  const [selectedAvoid, setSelectedAvoid] = useState<string[]>([]);
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [level, setLevel] = useState<string>('');

  const normalizedIngredients = useMemo(
    () => ingredients.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
    [ingredients],
  );

  const coherenceScore = useMemo(() => {
    let score = 20;
    if (normalizedIngredients.length > 0) score += 20;
    if (selectedRegional.length > 0) score += 20;
    if (selectedStyle.length > 0) score += 15;
    if (selectedGoals.length > 0) score += 15;
    if (level) score += 10;
    return Math.min(100, score);
  }, [normalizedIngredients.length, selectedRegional.length, selectedStyle.length, selectedGoals.length, level]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        ingredients: string;
        regional: string[];
        style: string[];
        goals: string[];
        avoid: string[];
        level: string;
      };
      setIngredients(parsed.ingredients ?? '');
      setSelectedRegional(parsed.regional ?? []);
      setSelectedStyle(parsed.style ?? []);
      setSelectedGoals(parsed.goals ?? []);
      setSelectedAvoid(parsed.avoid ?? []);
      setLevel(parsed.level ?? '');
    } catch {
      // ignore invalid storage
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ingredients,
        regional: selectedRegional,
        style: selectedStyle,
        goals: selectedGoals,
        avoid: selectedAvoid,
        level,
      }),
    );
  }, [ingredients, level, selectedAvoid, selectedGoals, selectedRegional, selectedStyle]);

  useEffect(() => {
    const loadTerms = async () => {
      const supabase = getSupabaseBrowserClient();
      const [{ data: termsData }, { data: dimensionsData }] = await Promise.all([
        supabase.from('culinary_terms').select('id,label,dimension_id').eq('is_active', true).limit(120),
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

  const termSet = useMemo(() => new Set(terms.map((term) => term.label)), [terms]);
  const regionalOptions = REGIONAL_CONFIG.options.filter((option) => termSet.has(option));
  const styleOptions = STYLE_CONFIG.options.filter((option) => termSet.has(option));
  const goalOptions = GOAL_CONFIG.options.filter((option) => termSet.has(option));
  const avoidOptions = AVOID_CONFIG.options.filter((option) => termSet.has(option));
  const levelOptions = terms.filter((t) => t.dimension === 'skill_level');

  const toggleWithMax = (
    setFn: React.Dispatch<React.SetStateAction<string[]>>,
    value: string,
    max: number,
  ) => {
    setFn((prev) => {
      if (prev.includes(value)) return prev.filter((v) => v !== value);
      if (prev.length >= max) return prev;
      return [...prev, value];
    });
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setRecipe('');
    setCitations([]);

    try {
      const supabase = getSupabaseBrowserClient();
      const selectedPreferred = [...selectedRegional, ...selectedStyle];
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

  const applyTemplate = (template: (typeof QUICK_TEMPLATES)[number]) => {
    setIngredients(template.ingredients);
    setSelectedRegional(template.regional);
    setSelectedStyle(template.style);
    setSelectedGoals(template.goals);
    setSelectedAvoid(template.avoid);
    setLevel(template.level);
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Sistema culinario inteligente</h1>
            <p className="text-[#6B5A50]">CocinaCore entiende cómo cocinas para sugerir mejor.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">Volver</Link>
        </div>

        <form onSubmit={handleSubmit} className="grid gap-4">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-base font-semibold">Plantillas rápidas</p>
            <p className="text-sm text-[#6B5A50]">Atajos premium para empezar en segundos.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className="rounded-full border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B5A50] transition hover:border-[#C56A1A]/40 hover:text-[#A55412]"
                >
                  {template.label}
                </button>
              ))}
            </div>
          </article>

          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <label htmlFor="ingredients" className="text-sm font-semibold text-[#6B5A50]">Ingredientes</label>
            <input
              id="ingredients"
              value={ingredients}
              onChange={(event) => setIngredients(event.target.value)}
              placeholder="pollo, tomate, arroz, cebolla"
              className="mt-2 h-12 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none transition focus:border-[#6D4AFF] focus:ring-2 focus:ring-[#6D4AFF]/20"
            />
          </div>

          <SelectionCard
            title={REGIONAL_CONFIG.title}
            subtitle={REGIONAL_CONFIG.subtitle}
            selected={selectedRegional}
            options={regionalOptions}
            onToggle={(value) => toggleWithMax(setSelectedRegional, value, REGIONAL_CONFIG.max)}
            activeClassName="border-[#6D4AFF]/50 bg-[#6D4AFF]/10 text-[#6D4AFF]"
            idleClassName="border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#6D4AFF]/30"
          />

          <SelectionCard
            title={STYLE_CONFIG.title}
            subtitle={STYLE_CONFIG.subtitle}
            selected={selectedStyle}
            options={styleOptions}
            onToggle={(value) => toggleWithMax(setSelectedStyle, value, STYLE_CONFIG.max)}
            activeClassName="border-[#C56A1A]/50 bg-[#C56A1A]/10 text-[#A55412]"
            idleClassName="border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#C56A1A]/30"
          />

          <SelectionCard
            title={GOAL_CONFIG.title}
            subtitle={GOAL_CONFIG.subtitle}
            selected={selectedGoals}
            options={goalOptions}
            onToggle={(value) => toggleWithMax(setSelectedGoals, value, GOAL_CONFIG.max)}
            activeClassName="border-[#567A3B]/50 bg-[#567A3B]/10 text-[#567A3B]"
            idleClassName="border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#567A3B]/30"
          />

          <SelectionCard
            title={AVOID_CONFIG.title}
            subtitle={AVOID_CONFIG.subtitle}
            selected={selectedAvoid}
            options={avoidOptions}
            onToggle={(value) => toggleWithMax(setSelectedAvoid, value, AVOID_CONFIG.max)}
            activeClassName="border-red-300 bg-red-50 text-red-700"
            idleClassName="border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-red-300"
          />

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-base font-semibold">Nivel culinario</p>
            <p className="text-sm text-[#6B5A50]">¿Qué nivel de cocina tienes?</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setLevel('')}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold ${level === '' ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
              >
                Sin preferencia
              </button>
              {levelOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLevel(option.label)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold ${level === option.label ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </article>

          <div className="rounded-2xl border border-[#E8DDD2] bg-[#faf2e9] px-3 py-2 text-xs text-[#6B5A50]">
            Máximo: 2 cocinas regionales, 2 estilos y 3 objetivos para mantener recomendaciones coherentes.
          </div>

          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#6B5A50]">
              <span>Coherencia del prompt</span>
              <span>{coherenceScore}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[#EEE3D9]">
              <div className="h-2 rounded-full bg-[#6D4AFF]" style={{ width: `${coherenceScore}%` }} />
            </div>
          </div>

          <button type="submit" disabled={loading} className="h-12 rounded-xl bg-[#C56A1A] text-base font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60">
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
