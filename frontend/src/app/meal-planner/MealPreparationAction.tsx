'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import type { StructuredRecipeIngredient } from '@/components/recipe-view/types';
import { RecipeGenerateSchema } from '@/lib/validation';
import { buildRecipeGenerationRequestPayload } from '@/lib/recipes/today-handoff';
import { buildRecipeImportPayload } from '@/lib/recipes/recipe-import';
import { RecipeEditor, draftFromImport, payloadFromDraft, type Draft } from '../recipes/RecipeLibraryClient';
import type { StructuredMeal } from '@/lib/meal-planner/structured-plan';

interface GeneratedPreparation {
  title: string;
  recipe: string;
  preparation?: string;
  structuredIngredients?: StructuredRecipeIngredient[];
  servings?: number;
  recipeHistoryId?: string;
}

const mealTypeLabels = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
} as const;

/** A recipe is requested only after the user clicks. Never mark a meal cooked or consume stock here. */
export default function MealPreparationAction({
  meal,
  peopleCount,
  hardRestrictions,
}: {
  meal: StructuredMeal;
  peopleCount: number;
  hardRestrictions: readonly string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedPreparation | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedRecipeId, setSavedRecipeId] = useState<string | null>(null);
  const generateLock = useRef(false);
  const saveLock = useRef(false);

  // An already-linked recipe is the source of truth: never regenerate it.
  if (meal.recipeRef) {
    return (
      <Link href={`/recipes/${meal.recipeRef.recipeId}`} className="text-sm font-semibold text-bistro-action-primary underline">
        Ver preparación
      </Link>
    );
  }

  const onViewPreparation = async () => {
    if (generateLock.current || saveLock.current) return;
    if (expanded && (result || error)) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (result) return;

    const payload = buildRecipeGenerationRequestPayload({
      mode: 'free',
      recipeName: meal.title,
      ingredients: meal.ingredients.map((item) => item.name).join('\n'),
      restrictions: hardRestrictions.join(','),
      todayFields: {
        recipeName: meal.title,
        mealType: mealTypeLabels[meal.mealType],
        ingredients: meal.ingredients.map((item) => item.name),
        targetServings: peopleCount,
      },
    });
    if (!RecipeGenerateSchema.safeParse(payload).success) {
      setError('No se puede generar esta preparación con los datos actuales del menú. Revisa las restricciones.');
      return;
    }

    generateLock.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await safeFetch<GeneratedPreparation>('/api/recipe-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(response.error ?? 'No se pudo generar la preparación.');
      setResult(response.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar la preparación.');
    } finally {
      setLoading(false);
      generateLock.current = false;
    }
  };

  const onSave = async (draft: Draft) => {
    if (!result?.recipeHistoryId || !reviewing || generateLock.current || saveLock.current || savedRecipeId) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await safeFetch<{ recipe: { id: string } }>('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...payloadFromDraft(draft), sourceRecipeHistoryId: result.recipeHistoryId }),
      });
      if (!response.ok) throw new Error(response.error ?? 'No se pudo guardar la receta.');
      setSavedRecipeId(response.data.recipe.id);
      setReviewing(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'No se pudo guardar la receta.');
    } finally {
      setSaving(false);
      saveLock.current = false;
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void onViewPreparation()}
        disabled={loading || saving}
        aria-expanded={expanded}
        className="h-9 rounded-lg border border-bistro-action-primary px-3 text-sm font-semibold text-bistro-action-primary disabled:opacity-60"
      >
        {loading ? 'Generando preparación...' : expanded ? 'Ocultar preparación' : result ? 'Ver preparación' : error ? 'Reintentar preparación' : 'Ver preparación'}
      </button>
      {expanded ? (
        <section className="mt-3 rounded-xl border border-bistro-border bg-bistro-page p-3" aria-label={`Preparación de ${meal.title}`}>
          {loading ? <p role="status" className="text-sm text-bistro-text-secondary">Preparando la receta con IA...</p> : null}
          {error ? <p role="alert" className="text-sm text-bistro-danger">{error}</p> : null}
          {result ? (
            <div className="grid gap-3">
              <h4 className="font-semibold">{result.title}</h4>
              <p className="text-xs text-bistro-text-secondary">Propuesta generada por IA. Revisa los ingredientes y sus cantidades antes de cocinar; no certifica ausencia de alérgenos.</p>
              <div className="whitespace-pre-wrap text-sm text-bistro-text-primary">{result.preparation || result.recipe}</div>
              {savedRecipeId ? (
                <p role="status" className="text-sm text-bistro-success">
                  Receta guardada. <Link href={`/recipes/${savedRecipeId}`} className="font-semibold underline">Ver en Mis recetas</Link>
                </p>
              ) : reviewing && result.recipeHistoryId ? (
                <div>
                  <RecipeEditor
                    key={result.recipeHistoryId}
                    initial={draftFromImport(buildRecipeImportPayload({
                      title: result.title,
                      instructions: result.recipe,
                      preparation: result.preparation,
                      structuredIngredients: result.structuredIngredients ?? [],
                      servings: result.servings ?? peopleCount,
                      recipeHistoryId: result.recipeHistoryId,
                    }))}
                    saving={saving}
                    saveLabel="Confirmar y guardar"
                    onSave={(draft) => void onSave(draft)}
                    onCancel={() => { if (!saveLock.current) setReviewing(false); }}
                  />
                  {saveError ? <p role="alert" className="mt-2 text-sm text-bistro-danger">{saveError}</p> : null}
                </div>
              ) : result.recipeHistoryId ? (
                <button
                  type="button"
                  className="w-fit rounded-lg bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white"
                  onClick={() => { setSaveError(null); setReviewing(true); }}
                >
                  Guardar en Mis recetas
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
