'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { humanCopy } from '@/lib/copy';
import { RecipeView } from '@/components/recipe-view/RecipeView';
import type { RecipeCitation, StructuredRecipeIngredient } from '@/components/recipe-view/types';

type MatchChunkRow = {
  id: string;
  content: string;
  similarity: number | string | null;
  metadata?: { page_number?: number; book_title?: string };
};
type GenerationMode = 'free' | 'rag';
const RAG_SIMILARITY_THRESHOLD = 0.72;

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
  options: [
    'Casera',
    'Gourmet',
    'Rápida',
    'Comfort food',
    'Parrilla',
    'Saludable',
    'Vegana',
    'Postres',
  ],
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
const RECIPE_SESSION_KEY = 'cocinacore_recipe_sessions_v1';
const RECIPE_TTL_MS = 12 * 60 * 60 * 1000;

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

type RecipeSections = {
  title: string;
  ingredients: string[];
  preparation: string[];
  tips: string[];
  fallback: string;
};

function cleanRecipeText(raw: string): string {
  return raw
    .replace(/\[TITULO\]/gi, '')
    .replace(/^TITULO:?/gim, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gim, '')
    .trim();
}

function normalizeTitleCandidate(value: string): string {
  return value
    .replace(/^\[|\]$/g, '')
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/, '')
    .replace(/^[-–—]\s*/, '')
    .trim();
}

function inferCleanTitle(lines: string[]): string {
  const direct = lines
    .map((line) => normalizeTitleCandidate(line))
    .find((line) => line.length > 0 && line.length <= 70 && !/[.!?]$/.test(line));
  if (direct) return direct;

  const joined = lines.join(' ');
  const recipePattern = joined.match(
    /(?:receta de|prepara(?:ción)? de)\s+([A-ZÁÉÍÓÚÑ][^,.]{3,60})/i
  );
  if (recipePattern?.[1]) return normalizeTitleCandidate(recipePattern[1]);

  const laPattern = joined.match(
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+){0,5})\s+es\s+un/i
  );
  if (laPattern?.[1]) return normalizeTitleCandidate(laPattern[1]);

  return 'Receta CocinaCore';
}

function parseRecipeSections(raw: string): RecipeSections {
  const cleaned = cleanRecipeText(raw);
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = inferCleanTitle(lines);

  const ingredients: string[] = [];
  const preparation: string[] = [];
  const tips: string[] = [];
  let current: 'ingredients' | 'preparation' | 'tips' | null = null;

  for (const line of lines.slice(1)) {
    const lower = line.toLowerCase();
    if (lower.startsWith('ingredientes')) {
      current = 'ingredients';
      continue;
    }
    if (lower.startsWith('preparación') || lower.startsWith('preparacion')) {
      current = 'preparation';
      continue;
    }
    if (lower.startsWith('tips')) {
      current = 'tips';
      continue;
    }
    if (lower.startsWith('fuente')) {
      current = null;
      continue;
    }

    if (current === 'ingredients') ingredients.push(line.replace(/^-+\s*/, ''));
    if (current === 'preparation') preparation.push(line.replace(/^\d+[\.)-]?\s*/, ''));
    if (current === 'tips') tips.push(line.replace(/^-+\s*/, ''));
  }

  return { title, ingredients, preparation, tips, fallback: cleaned };
}

type RecipeSession = {
  id: string;
  historyId: string | null;
  title: string;
  recipe: string;
  mode: GenerationMode;
  peopleCount: number;
  structuredIngredients: StructuredRecipeIngredient[];
  saved: boolean;
  createdAt: number;
  expiresAt: number;
};

type HistoryRow = {
  id: string;
  recipe_title: string | null;
  recipe_payload: {
    full_recipe?: string;
    mode?: GenerationMode;
    structured_ingredients?: StructuredRecipeIngredient[];
    citations?: Array<{
      id?: string;
      similarity?: number;
      metadata?: { page_number?: number; book_title?: string };
    }>;
  };
  is_saved: boolean;
  expires_at: string | null;
  created_at: string;
};

function readRecipeSessions(): RecipeSession[] {
  try {
    const raw = localStorage.getItem(RECIPE_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecipeSession[];
    const now = Date.now();
    return parsed.filter((item) => item.expiresAt > now);
  } catch {
    return [];
  }
}

function saveRecipeSessions(sessions: RecipeSession[]) {
  localStorage.setItem(RECIPE_SESSION_KEY, JSON.stringify(sessions));
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
  const [peopleCount, setPeopleCount] = useState<number>(4);
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
  const [mode, setMode] = useState<GenerationMode>('free');
  const [recipeMode, setRecipeMode] = useState<GenerationMode>('free');
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeSessions, setRecipeSessions] = useState<RecipeSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [structuredIngredients, setStructuredIngredients] = useState<StructuredRecipeIngredient[]>(
    []
  );

  const normalizedIngredients = useMemo(
    () =>
      ingredients
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    [ingredients]
  );

  const coherenceScore = useMemo(() => {
    let score = 20;
    if (normalizedIngredients.length > 0) score += 20;
    if (selectedRegional.length > 0) score += 20;
    if (selectedStyle.length > 0) score += 15;
    if (selectedGoals.length > 0) score += 15;
    if (level) score += 10;
    return Math.min(100, score);
  }, [
    normalizedIngredients.length,
    selectedRegional.length,
    selectedStyle.length,
    selectedGoals.length,
    level,
  ]);
  const parsedRecipe = useMemo(() => (recipe ? parseRecipeSections(recipe) : null), [recipe]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        ingredients: string;
        peopleCount?: number;
        regional: string[];
        style: string[];
        goals: string[];
        avoid: string[];
        level: string;
      };
      setIngredients(parsed.ingredients ?? '');
      setPeopleCount(
        typeof parsed.peopleCount === 'number' &&
          Number.isFinite(parsed.peopleCount) &&
          parsed.peopleCount > 0
          ? Math.floor(parsed.peopleCount)
          : 4
      );
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
    const loadRecentRecipes = async () => {
      const local = readRecipeSessions();
      const now = Date.now();
      const supabase = getSupabaseBrowserClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setRecipeSessions(local);
        saveRecipeSessions(local);
        return;
      }

      const { data: rows } = await supabase
        .from('recipe_ai_history')
        .select('id,recipe_title,recipe_payload,is_saved,expires_at,created_at')
        .eq('user_id', authData.user.id)
        .or(`is_saved.eq.true,expires_at.gt.${new Date().toISOString()}`)
        .order('created_at', { ascending: false })
        .limit(20);

      const dbSessions: RecipeSession[] = ((rows ?? []) as HistoryRow[])
        .map((row) => {
          const mappedMode: GenerationMode = row.recipe_payload?.mode === 'rag' ? 'rag' : 'free';
          return {
            id: row.id,
            historyId: row.id,
            title:
              row.recipe_title ??
              parseRecipeSections(String(row.recipe_payload?.full_recipe ?? '')).title,
            recipe: String(row.recipe_payload?.full_recipe ?? ''),
            mode: mappedMode,
            peopleCount: 4,
            structuredIngredients: Array.isArray(row.recipe_payload?.structured_ingredients)
              ? row.recipe_payload.structured_ingredients
              : [],
            saved: Boolean(row.is_saved),
            createdAt: new Date(row.created_at).getTime(),
            expiresAt: row.is_saved
              ? Number.MAX_SAFE_INTEGER
              : row.expires_at
                ? new Date(row.expires_at).getTime()
                : now + RECIPE_TTL_MS,
          };
        })
        .filter((item) => item.recipe.trim().length > 0);

      const merged: RecipeSession[] = [...dbSessions, ...local]
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter(
          (item, index, arr) =>
            arr.findIndex((x) => x.title === item.title && x.createdAt === item.createdAt) === index
        )
        .slice(0, 20)
        .filter((item) => item.saved || item.expiresAt > now);

      setRecipeSessions(merged);
      saveRecipeSessions(merged);
    };
    void loadRecentRecipes();
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ingredients,
        peopleCount,
        regional: selectedRegional,
        style: selectedStyle,
        goals: selectedGoals,
        avoid: selectedAvoid,
        level,
      })
    );
  }, [
    ingredients,
    peopleCount,
    level,
    selectedAvoid,
    selectedGoals,
    selectedRegional,
    selectedStyle,
  ]);

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
        }))
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
    max: number
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
    setRecipeMode(mode);

    try {
      const supabase = getSupabaseBrowserClient();
      const selectedPreferred = [...selectedRegional, ...selectedStyle];
      const safePeopleCount =
        Number.isFinite(peopleCount) && peopleCount > 0 ? Math.floor(peopleCount) : 4;
      let safeChunks: MatchChunkRow[] = [];
      if (mode === 'rag') {
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
          match_threshold: RAG_SIMILARITY_THRESHOLD,
          match_count: 8,
          filter_tenant_id: null,
        });

        if (rpcErr) throw rpcErr;

        safeChunks = ((chunkRows ?? []) as MatchChunkRow[])
          .filter(
            (row) =>
              row.content &&
              safeSimilarity(row.similarity) > 0 &&
              safeSimilarity(row.similarity) >= RAG_SIMILARITY_THRESHOLD
          )
          .sort((a, b) => safeSimilarity(b.similarity) - safeSimilarity(a.similarity));
      }

      const recipeRes = await fetch('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          peopleCount: safePeopleCount,
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
        const payload = await readErrorPayload(recipeRes, humanCopy.recipeGenerateError);
        throw new Error(payload.error ?? humanCopy.recipeGenerateError);
      }

      const recipePayload = (await recipeRes.json()) as {
        recipe: string;
        mode?: GenerationMode;
        structuredIngredients?: StructuredRecipeIngredient[];
      };
      setRecipe(recipePayload.recipe);
      setRecipeMode(recipePayload.mode ?? mode);
      setStructuredIngredients(
        Array.isArray(recipePayload.structuredIngredients)
          ? recipePayload.structuredIngredients
          : []
      );
      setCitations(mode === 'rag' ? safeChunks.slice(0, 4) : []);
      setRecipeModalOpen(true);

      const now = Date.now();
      let historyId: string | null = null;
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: userRow } = await supabase
          .from('users')
          .select('tenant_id')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (userRow?.tenant_id) {
          const recipeTitle = parseRecipeSections(recipePayload.recipe).title;
          const { data: insertedHistory, error: insertHistoryError } = await supabase
            .from('recipe_ai_history')
            .insert({
              tenant_id: userRow.tenant_id,
              user_id: authData.user.id,
              source: mode === 'rag' ? 'pdf_search' : 'ai_generation',
              recipe_title: recipeTitle,
              recipe_payload: {
                title: recipeTitle,
                full_recipe: recipePayload.recipe,
                mode,
                citations:
                  mode === 'rag'
                    ? safeChunks.slice(0, 4).map((row) => ({
                        id: row.id,
                        similarity: safeSimilarity(row.similarity),
                        metadata: row.metadata ?? {},
                      }))
                    : [],
                structured_ingredients: Array.isArray(recipePayload.structuredIngredients)
                  ? recipePayload.structuredIngredients
                  : [],
              },
              restrictions_snapshot: {
                avoid: selectedAvoid,
                goals: selectedGoals,
                level: level || null,
              },
              inventory_snapshot: normalizedIngredients,
              is_saved: false,
              expires_at: new Date(now + RECIPE_TTL_MS).toISOString(),
            })
            .select('id')
            .single();

          if (!insertHistoryError && insertedHistory) {
            historyId = insertedHistory.id;
          }
        }
      }

      const newSession: RecipeSession = {
        id: crypto.randomUUID(),
        historyId,
        title: parseRecipeSections(recipePayload.recipe).title,
        recipe: recipePayload.recipe,
        mode: recipePayload.mode ?? mode,
        peopleCount: safePeopleCount,
        structuredIngredients: Array.isArray(recipePayload.structuredIngredients)
          ? recipePayload.structuredIngredients
          : [],
        saved: false,
        createdAt: now,
        expiresAt: now + RECIPE_TTL_MS,
      };
      const updatedSessions = [newSession, ...recipeSessions]
        .slice(0, 20)
        .filter((item) => item.expiresAt > now);
      setRecipeSessions(updatedSessions);
      saveRecipeSessions(updatedSessions);
      setActiveSessionId(newSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : humanCopy.recipeGenerateError);
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

  const openSession = (session: RecipeSession) => {
    setRecipe(session.recipe);
    setRecipeMode(session.mode);
    setPeopleCount(session.peopleCount);
    setStructuredIngredients(session.structuredIngredients);
    setCitations([]);
    setActiveSessionId(session.id);
    setRecipeModalOpen(true);
  };

  const saveActiveRecipe = async () => {
    if (!activeSessionId || savingRecipe) return;
    const current = recipeSessions.find((session) => session.id === activeSessionId);
    if (!current) return;

    setSavingRecipe(true);
    try {
      if (current.historyId) {
        const supabase = getSupabaseBrowserClient();
        await supabase
          .from('recipe_ai_history')
          .update({ is_saved: true, expires_at: null })
          .eq('id', current.historyId);
      }

      const updated = recipeSessions.map((session) =>
        session.id === activeSessionId
          ? { ...session, saved: true, expiresAt: Number.MAX_SAFE_INTEGER }
          : session
      );
      setRecipeSessions(updated);
      saveRecipeSessions(updated);
    } finally {
      setSavingRecipe(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Sistema culinario inteligente</h1>
            <p className="text-[#6B5A50]">CocinaCore entiende cómo cocinas para sugerir mejor.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
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
            <label htmlFor="ingredients" className="text-sm font-semibold text-[#6B5A50]">
              Ingredientes
            </label>
            <input
              id="ingredients"
              value={ingredients}
              onChange={(event) => setIngredients(event.target.value)}
              placeholder="pollo, tomate, arroz, cebolla"
              className="mt-2 h-12 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none transition focus:border-[#6D4AFF] focus:ring-2 focus:ring-[#6D4AFF]/20"
            />
            <label
              htmlFor="peopleCount"
              className="mt-3 block text-sm font-semibold text-[#6B5A50]"
            >
              Comensales
            </label>
            <input
              id="peopleCount"
              type="number"
              min={1}
              max={20}
              value={peopleCount}
              onChange={(event) =>
                setPeopleCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
              }
              className="mt-2 h-12 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 text-sm outline-none transition focus:border-[#6D4AFF] focus:ring-2 focus:ring-[#6D4AFF]/20"
            />
          </div>
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-base font-semibold">Modo de generación</p>
            <p className="text-sm text-[#6B5A50]">
              Elegí si querés receta libre o receta basada en biblioteca.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode('free')}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${mode === 'free' ? 'border-[#C56A1A]/40 bg-[#C56A1A]/10 text-[#A55412]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
              >
                {humanCopy.createWithMe}
              </button>
              <button
                type="button"
                onClick={() => setMode('rag')}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${mode === 'rag' ? 'border-[#6D4AFF]/40 bg-[#6D4AFF]/10 text-[#6D4AFF]' : 'border-[#E8DDD2] bg-white text-[#6B5A50]'}`}
              >
                {humanCopy.searchInPdfs}
              </button>
            </div>
          </article>

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
            Máximo: 2 cocinas regionales, 2 estilos y 3 objetivos para mantener recomendaciones
            coherentes.
          </div>

          <div className="rounded-2xl border border-[#E8DDD2] bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#6B5A50]">
              <span>Coherencia del prompt</span>
              <span>{coherenceScore}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-[#EEE3D9]">
              <div
                className="h-2 rounded-full bg-[#6D4AFF]"
                style={{ width: `${coherenceScore}%` }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="h-12 rounded-xl bg-[#C56A1A] text-base font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
          >
            {loading ? 'Generando...' : 'Generar receta'}
          </button>
        </form>

        {recipeSessions.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Recetas recientes (12h)</h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {recipeSessions.map((session) => (
                <article
                  key={session.id}
                  className="rounded-xl border border-[#E8DDD2] bg-white p-3"
                >
                  <p className="line-clamp-1 text-sm font-semibold text-[#241A14]">
                    {session.title}
                  </p>
                  <p className="mt-1 text-xs text-[#6B5A50]">
                    {session.mode === 'rag' ? humanCopy.basedOnLibrary : humanCopy.freeGeneration} ·{' '}
                    {session.peopleCount} comensales · {session.saved ? 'Guardada' : 'Temporal 12h'}
                  </p>
                  <button
                    type="button"
                    onClick={() => openSession(session)}
                    className="mt-2 rounded-lg border border-[#E8DDD2] px-2.5 py-1 text-xs font-semibold text-[#6B5A50]"
                  >
                    Abrir receta
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <RecipeView
          open={recipeModalOpen && Boolean(recipe)}
          recipe={recipe}
          recipeMode={recipeMode}
          peopleCount={peopleCount}
          level={level || 'Intermedio'}
          region={selectedRegional[0] ?? 'Fusión'}
          style={selectedStyle[0] ?? 'Casera'}
          parsedRecipe={parsedRecipe}
          citations={
            citations.map((item, index) => ({
              ...item,
              id: item.id || `citation-${index}`,
            })) as RecipeCitation[]
          }
          structuredIngredients={structuredIngredients}
          selectedInventory={normalizedIngredients}
          savingRecipe={savingRecipe}
          onClose={() => setRecipeModalOpen(false)}
          onSave={() => void saveActiveRecipe()}
        />
      </section>
    </main>
  );
}
