'use client';

import { useEffect, useMemo, useState } from 'react';
import { safeFetch } from '@/lib/api';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';

type SelectionProps = { recipeId: string; versionId: string };
type Selection = { dayIndex: number; mealType: StructuredMealType };

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
    if (!plan?.id || !plan.updatedAt || !plan.plan) return;
    setSaving(true);
    setMessage('');
    const result = await safeFetch<{ status: 'applied' | 'already_applied' }>(
      '/api/meal-plan/recipe-selection',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mealPlanId: plan.id,
          dayIndex: selection.dayIndex,
          mealType: selection.mealType,
          recipeId,
          versionId,
          expectedUpdatedAt: plan.updatedAt,
          expectedCalendarPayload: plan.plan,
          confirmed: true,
        }),
      }
    );
    setMessage(
      result.ok
        ? `Selección ${result.data.status === 'applied' ? 'guardada' : 'ya aplicada'}.`
        : result.error
    );
    if (result.ok) setPlan(null);
    setSaving(false);
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl border border-[#C56A1A] px-3 py-2 text-sm font-semibold text-[#8C4712]"
        aria-expanded={open}
      >
        {open ? 'Cerrar selección' : 'Elegir slot del menú'}
      </button>
      {open && (
        <div className="mt-3 grid gap-2 rounded-2xl bg-[#FAF6F1] p-3">
          {loading && <p role="status">Cargando menú…</p>}
          {!loading && !plan?.plan && <p>No hay un menú guardado disponible.</p>}
          {!loading && plan?.plan && (
            <>
              <label className="grid gap-1 text-sm font-semibold">
                Slot confirmado
                <select
                  className={inputClass}
                  value={`${selection.dayIndex}:${selection.mealType}`}
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
                      Día {dayIndex} · {meal.mealType} · {meal.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={saving || !plan.plan.schedule?.portionConfirmation}
                onClick={() => void saveSelection()}
                className="rounded-xl bg-[#C56A1A] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Confirmar selección'}
              </button>
              {!plan.plan.schedule?.portionConfirmation && (
                <p className="text-xs text-amber-800">
                  Confirmá agenda y porciones antes de seleccionar.
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

const inputClass = 'w-full rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-[#3B2F26]';
