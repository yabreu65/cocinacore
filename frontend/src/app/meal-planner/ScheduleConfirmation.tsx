'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { safeFetch } from '@/lib/api';
import type { StructuredMealPlan, StructuredMealPlanSchedule } from '@/lib/meal-planner/structured-plan';

type Props = {
  plan: StructuredMealPlan;
  mealPlanId: string;
  peopleCount: number;
  disabled: boolean;
  onConfirmed: (mealPlanId: string, plan: StructuredMealPlan, schedule: StructuredMealPlanSchedule) => void;
};

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export default function ScheduleConfirmation({ plan, mealPlanId, peopleCount, disabled, onConfirmed }: Props) {
  const [startDate, setStartDate] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeZone] = useState(browserTimeZone);
  const pending = useRef(false);
  const current = useRef({ plan, mealPlanId });
  useEffect(() => { current.current = { plan, mealPlanId }; }, [plan, mealPlanId]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const unknownIngredients = plan.days.some((day) => day.meals.some((meal) =>
    meal.ingredients.some((ingredient) => ingredient.quantity == null || !ingredient.unit?.trim())
  ));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || disabled || !confirmed) return;
    if (!startDate || startDate < localToday()) {
      setError('Elegí una fecha de inicio válida, hoy o futura.');
      return;
    }
    pending.current = true;
    setSaving(true);
    setError(null);
    const stillCurrent = () => mounted.current && current.current.plan === plan && current.current.mealPlanId === mealPlanId;
    try {
      const result = await safeFetch<{ mealPlanId: string; schedule: StructuredMealPlanSchedule }>('/api/meal-plan/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mealPlanId, startDate, timeZone, confirmed: true, portionBasisConfirmed: true }),
      });
      if (!stillCurrent()) return;
      if (!result.ok) throw new Error(result.error || 'No se pudo confirmar la agenda.');
      if (result.data.mealPlanId !== mealPlanId || !result.data.schedule?.portionConfirmation) {
        throw new Error('No se pudo validar la agenda confirmada.');
      }
      onConfirmed(mealPlanId, plan, result.data.schedule);
    } catch (failure) {
      if (stillCurrent()) setError(failure instanceof Error ? failure.message : 'No se pudo confirmar la agenda.');
    } finally {
      pending.current = false;
      if (stillCurrent()) setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-bistro-border bg-white p-4" aria-labelledby="schedule-title">
      {plan.schedule?.portionConfirmation ? (
        <><h2 id="schedule-title" className="font-semibold">Agenda confirmada</h2>
          <p className="mt-1 text-sm text-bistro-text-secondary">Inicio: {plan.schedule.startDate} · {plan.schedule.timeZone} · {plan.schedule.portionConfirmation.peopleCount} comensales</p></>
      ) : (
        <><h2 id="schedule-title" className="font-semibold">1. Confirmar fecha y porciones</h2>
          <p className="mt-1 text-sm text-bistro-text-secondary">Este menú guardado es para {peopleCount} comensales.</p>
          {unknownIngredients ? <p className="mt-2 rounded-lg bg-bistro-warning/10 p-3 text-sm text-bistro-warning">La agenda habilita el cálculo, pero los ingredientes sin cantidad o unidad aparecerán pendientes de revisión; no se puede calcular su compra exacta.</p> : null}
          <form onSubmit={submit} className="mt-3 grid gap-3">
            <label className="grid gap-1 text-sm font-semibold">Fecha de inicio
              <input type="date" required min={localToday()} value={startDate} onChange={(event) => setStartDate(event.target.value)} className="min-h-11 rounded-xl border border-bistro-border px-3" />
              <span className="text-xs font-normal">Zona horaria: {timeZone}</span>
            </label>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />Confirmo que revisé las cantidades y porciones declaradas en este menú para {peopleCount} comensales.</label>
            {error ? <p role="alert" className="text-sm text-bistro-danger">{error}</p> : null}
            <button type="submit" disabled={disabled || saving || !confirmed || !startDate} className="min-h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60">{saving ? 'Guardando…' : 'Confirmar agenda y porciones'}</button>
          </form></>
      )}
    </section>
  );
}
