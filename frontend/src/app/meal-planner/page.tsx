'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StructuredMealPlan | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
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
          restrictions: restrictions.split(',').map((r) => r.trim()).filter(Boolean),
          mode: 'balanced_ai',
        }),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo generar el menú.');
      }

      const data = result.data;
      if (!data.plan) {
        throw new Error('El proveedor IA no devolvió un menú estructurado.');
      }
      setPlan(data.plan);
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
            <h1 className="text-3xl font-semibold">Planificador de menú</h1>
            <p className="text-[#6B5A50]">Generá un menú para el período elegido con IA.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Comensales
            <input
              type="number"
              min={1}
              value={peopleCount}
              onChange={(e) => setPeopleCount(Number(e.target.value))}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Período
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as 'week' | 'fortnight' | 'month')}
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
              onChange={(e) => setBaseCuisine(e.target.value)}
              placeholder="Latinoamericana"
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
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

          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Generando...' : 'Generar menú'}
          </button>
        </form>

        {error ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
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
