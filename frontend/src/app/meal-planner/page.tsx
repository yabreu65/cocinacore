'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import {
  rehydrateMealPlanner,
  type MealPlanPublicResponse,
} from '@/lib/meal-planner/rehydration';
import type { StructuredMealPlan, StructuredMealType } from '@/lib/meal-planner/structured-plan';

const mealTypeLabels: Record<StructuredMealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

export default function MealPlannerPage() {
  const [peopleCount, setPeopleCount] = useState(4);
  const [period, setPeriod] = useState<'week' | 'fortnight' | 'month'>('week');
  const [baseCuisine, setBaseCuisine] = useState('');
  const [restrictions, setRestrictions] = useState('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StructuredMealPlan | null>(null);
  const generationStartedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const loadLatestMealPlan = async () => {
      try {
        const result = await safeFetch<MealPlanPublicResponse>('/api/meal-plan', {
          credentials: 'same-origin',
        });
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo cargar el menú guardado.');
        }
        if (!active || generationStartedRef.current) return;

        const restored = rehydrateMealPlanner(result.data);
        setPeopleCount(restored.peopleCount);
        setPeriod(restored.period);
        setBaseCuisine(restored.baseCuisine);
        setRestrictions(restored.restrictions);
        setPlan(restored.plan);
      } catch (error) {
        if (active && !generationStartedRef.current) {
          setLoadError(
            error instanceof Error ? error.message : 'No se pudo cargar el menú guardado.'
          );
        }
      } finally {
        if (active) setIsInitialLoading(false);
      }
    };

    void loadLatestMealPlan();
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    generationStartedRef.current = true;
    setIsGenerating(true);
    setGenerationError(null);
    setPlan(null);

    try {
      const result = await safeFetch<{ plan?: StructuredMealPlan; content?: string }>('/api/meal-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          peopleCount,
          period,
          baseCuisine: baseCuisine || 'Latinoamericana',
          fusionCuisines: [],
          fusionIntensity: 'media',
          restrictions: restrictions.split(',').map((restriction) => restriction.trim()).filter(Boolean),
          mode: 'balanced_ai',
        }),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo generar el menú.');
      }

      if (!result.data.plan) {
        throw new Error('El proveedor IA no devolvió un menú estructurado.');
      }
      setPlan(result.data.plan);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Planificador de menú</h1>
            <p className="text-[#6B5A50]">Generá un menú para el período elegido con IA.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        {isInitialLoading ? <p className="mb-3 text-sm text-[#6B5A50]">Cargando menú guardado...</p> : null}
        {loadError ? (
          <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No pudimos cargar el menú guardado. Podés generar uno nuevo.
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Comensales
            <input
              type="number"
              min={1}
              value={peopleCount}
              onChange={(event) => setPeopleCount(Number(event.target.value))}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Período
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as 'week' | 'fortnight' | 'month')}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            >
              <option value="week">Semana</option>
              <option value="fortnight">Quincena</option>
              <option value="month">Mes</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Cocina base
            <input
              value={baseCuisine}
              onChange={(event) => setBaseCuisine(event.target.value)}
              placeholder="Latinoamericana"
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Restricciones (separadas por comas)
            <input
              value={restrictions}
              onChange={(event) => setRestrictions(event.target.value)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={isGenerating}
            className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
          >
            {isGenerating ? 'Generando...' : 'Generar menú'}
          </button>
        </form>

        {generationError ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {generationError}
          </p>
        ) : null}

        {plan ? (
          <div className="mt-6 rounded-xl border border-[#E8DDD2] bg-[#faf7f3] p-4">
            <h2 className="font-semibold">Menú generado</h2>
            <div className="mt-3 grid gap-3">
              {plan.days.map((day) => (
                <section key={day.dayIndex} className="rounded-xl border border-[#E8DDD2] bg-white p-3">
                  <h3 className="font-semibold">{day.label}</h3>
                  <div className="mt-2 grid gap-2 text-sm">
                    {day.meals.map((meal) => (
                      <article key={meal.mealType}>
                        <p className="font-semibold text-[#6B5A50]">
                          {mealTypeLabels[meal.mealType]}: {meal.title}
                        </p>
                        {meal.description ? <p className="text-[#6B5A50]">{meal.description}</p> : null}
                        {meal.ingredients.length > 0 ? (
                          <ul className="mt-1 list-disc pl-5 text-[#6B5A50]">
                            {meal.ingredients.map((ingredient, index) => (
                              <li key={`${ingredient.name}-${index}`}>
                                {ingredient.quantity === null
                                  ? ingredient.name
                                  : `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''} ${ingredient.name}`}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
