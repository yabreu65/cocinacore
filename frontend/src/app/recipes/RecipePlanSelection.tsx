'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';

type SelectionProps = { recipeId: string; versionId: string };
type Selection = { dayIndex: number; mealType: StructuredMealType };

export function mealTypeInSpanish(type: StructuredMealType): string {
  switch (type) {
    case 'breakfast':
      return 'Desayuno';
    case 'lunch':
      return 'Almuerzo';
    case 'dinner':
      return 'Cena';
  }
}

export default function RecipePlanSelection({ recipeId, versionId }: SelectionProps) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MealPlanPublicResponse | null>(null);
  const [selection, setSelection] = useState<Selection>({ dayIndex: 1, mealType: 'lunch' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const slots = useMemo(
    () =>
      plan?.plan?.days.flatMap((day) =>
        day.meals.map((meal) => ({ dayIndex: day.dayIndex, meal }))
      ) ?? [],
    [plan]
  );

  const activeSelection = slots.some(
    ({ dayIndex, meal }) => dayIndex === selection.dayIndex && meal.mealType === selection.mealType
  )
    ? selection
    : slots.length > 0
      ? { dayIndex: slots[0].dayIndex, mealType: slots[0].meal.mealType }
      : null;

  useEffect(() => {
    if (!open || plan || loading) return;
    setLoading(true);
    void safeFetch<MealPlanPublicResponse>('/api/meal-plan', { credentials: 'same-origin' })
      .then((result) => {
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setPlan(result.data);
      })
      .catch(() => setMessage('No se pudo cargar el menú.'))
      .finally(() => setLoading(false));
  }, [loading, open, plan]);

  const saveSelection = async () => {
    if (!plan?.id || !plan.updatedAt || !plan.plan || !activeSelection || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const result = await safeFetch<{ status: 'applied' | 'already_applied' }>(
        '/api/meal-plan/recipe-selection',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mealPlanId: plan.id,
            dayIndex: activeSelection.dayIndex,
            mealType: activeSelection.mealType,
            recipeId,
            versionId,
            expectedUpdatedAt: plan.updatedAt,
            expectedCalendarPayload: plan.plan,
            confirmed: true,
          }),
        }
      );
      if (!result.ok) {
        setMessage(
          'No pudimos actualizar tu menú. Comprobá que esté confirmado e intentá de nuevo.'
        );
        return;
      }
      setMessage(
        result.data.status === 'applied'
          ? 'Receta agregada a la comida elegida.'
          : 'Esta receta ya estaba asociada a esa comida.'
      );
      setPlan(null);
    } catch {
      setMessage('No se pudo guardar el cambio por un problema de conexión. Intentá nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl border border-bistro-action-primary px-3 py-2 text-sm font-semibold text-bistro-action-primary"
        aria-expanded={open}
      >
        {open ? 'Cerrar opciones de menú' : 'Añadir a una comida del menú'}
      </button>
      {open && (
        <div className="mt-3 grid gap-2 rounded-2xl bg-bistro-page p-3">
          {loading && <p role="status">Cargando menú…</p>}
          {!loading && !plan?.plan && (
            <div className="rounded-xl border border-bistro-border bg-white p-3 text-sm text-bistro-text-secondary">
              <p>Todavía no tenés un menú guardado para asociar esta receta.</p>
              <Link
                href="/meal-planner"
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-bistro-action-primary underline underline-offset-4"
              >
                Crear mi menú
              </Link>
            </div>
          )}
          {!loading && plan?.plan && (
            <>
              <label className="grid gap-1 text-sm font-semibold">
                Comida donde querés usarla
                <select
                  className={inputClass}
                  value={
                    activeSelection ? `${activeSelection.dayIndex}:${activeSelection.mealType}` : ''
                  }
                  onChange={(event) => {
                    const [dayIndex, mealType] = event.target.value.split(':');
                    setSelection({
                      dayIndex: Number(dayIndex),
                      mealType: mealType as StructuredMealType,
                    });
                  }}
                >
                  {slots.map(({ dayIndex, meal }) => (
                    <option
                      key={`${dayIndex}:${meal.mealType}`}
                      value={`${dayIndex}:${meal.mealType}`}
                    >
                      Día {dayIndex} · {mealTypeInSpanish(meal.mealType)} · {meal.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={saving || !plan.plan.schedule?.portionConfirmation || !activeSelection}
                onClick={() => void saveSelection()}
                className="rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar en mi menú'}
              </button>
              {!plan.plan.schedule?.portionConfirmation && (
                <p className="text-xs text-bistro-warning">
                  Confirmá primero las comidas y porciones en el planificador para asociar esta
                  receta.
                </p>
              )}
            </>
          )}
          {message && (
            <p role="status" className="text-sm">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const inputClass =
  'w-full rounded-xl border border-bistro-border bg-white px-3 py-2 text-bistro-text-primary';
