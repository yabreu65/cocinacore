'use client';

import { useEffect, useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';
import { normalizeExplicitUnit } from '@/lib/inventory/quantity-normalization';
import type { StructuredMealPlan, StructuredMealType } from '@/lib/meal-planner/structured-plan';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';

type Item = { dayIndex: number; mealType: StructuredMealType; ingredientIndex: number; name: string; quantity: number | null; unit: string | null };
type Proposal = { mealPlanId: string; expectedUpdatedAt: string; fingerprint: string; items: Item[] };
type Draft = Item & { quantityText: string; selected: boolean };
type Props = {
  plan: StructuredMealPlan;
  mealPlanId: string;
  disabled: boolean;
  isCurrent: (plan: StructuredMealPlan, id: string) => boolean;
  onReloaded: (plan: StructuredMealPlan, id: string, result: MealPlanPublicResponse) => void;
};
const units = ['unidad', 'g', 'kg', 'ml', 'l', 'paquete', 'cucharada', 'cucharadita', 'taza'];
const labels: Record<StructuredMealType, string> = { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena' };

export function isQuantityReviewCurrent(active: boolean, generationInFlight: boolean, currentId: string | null, id: string, currentPlan: StructuredMealPlan | null, sourcePlan: StructuredMealPlan): boolean {
  return active && !generationInFlight && currentId === id && currentPlan === sourcePlan;
}

export async function reloadSavedPlan(mealPlanId: string): Promise<MealPlanPublicResponse | null> {
  try {
    const refreshed = await safeFetch<MealPlanPublicResponse>('/api/meal-plan', { credentials: 'same-origin' });
    return refreshed.ok && refreshed.data.id === mealPlanId && refreshed.data.plan ? refreshed.data : null;
  } catch {
    return null;
  }
}

export function reviewUnit(original: string | null, proposed: string | null): string | null {
  const existing = normalizeExplicitUnit(original);
  const estimate = normalizeExplicitUnit(proposed);
  return existing !== 'unknown' ? existing : estimate !== 'unknown' ? estimate : null;
}


export default function QuantityReview({ plan, mealPlanId, disabled, isCurrent, onReloaded }: Props) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [items, setItems] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && isCurrent(plan, mealPlanId);
  const hasUnknown = plan.days.some((day) => day.meals.some((meal) => meal.ingredients.some((ingredient) => ingredient.quantity == null || normalizeExplicitUnit(ingredient.unit) === 'unknown')));
  if (!hasUnknown || !plan.schedule?.portionConfirmation) return null;

  async function prepare() {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true); setError(null); setProposal(null); setItems([]);
    try {
      const result = await safeFetch<Proposal>('/api/meal-plan/quantity-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ mealPlanId }),
      });
      if (!current()) return;
      if (!result.ok) throw new Error(result.error || 'No se pudieron preparar las estimaciones.');
      if (result.data.mealPlanId !== mealPlanId) throw new Error('La propuesta no corresponde a este menú.');
      setProposal(result.data);
      setItems(result.data.items.map((item) => {
        const original = plan.days.find((day) => day.dayIndex === item.dayIndex)?.meals.find((meal) => meal.mealType === item.mealType)?.ingredients[item.ingredientIndex];
        const unit = reviewUnit(original?.unit ?? null, item.unit);
        return { ...item, unit, quantityText: String(original?.quantity ?? item.quantity ?? ''), selected: false };
      }));
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'No se pudieron preparar las estimaciones.');
    } finally { pending.current = false; if (current()) setBusy(false); }
  }

  async function save() {
    if (!proposal || pending.current || disabled) return;
    const selected = items.filter((item) => item.selected);
    if (!selected.length || selected.some((item) => !item.quantityText || !Number.isFinite(Number(item.quantityText)) || Number(item.quantityText) <= 0 || !item.unit || !units.includes(item.unit))) {
      setError('Elegí al menos un ingrediente con cantidad positiva y unidad válida.'); return;
    }
    pending.current = true; setBusy(true); setError(null);
    try {
      const result = await safeFetch<{ mealPlanId: string }>('/api/meal-plan/quantity-review', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ mealPlanId, expectedUpdatedAt: proposal.expectedUpdatedAt, fingerprint: proposal.fingerprint,
          items: selected.map(({ dayIndex, mealType, ingredientIndex, name, quantityText, unit }) => ({ dayIndex, mealType, ingredientIndex, name, quantity: Number(quantityText), unit })) }),
      });
      if (!current()) return;
      if (!result.ok) throw new Error(result.status === 409 ? 'El menú o las restricciones cambiaron. Volvé a cargar el menú antes de revisar las cantidades.' : result.error || 'No se pudieron guardar las cantidades.');
      if (result.data.mealPlanId !== mealPlanId) throw new Error('No se pudo validar el menú actualizado.');
      setProposal(null); setItems([]);
      const refreshed = await reloadSavedPlan(mealPlanId);
      if (!current()) return;
      if (!refreshed) {
        throw new Error('Las cantidades se guardaron, pero no se pudo recargar el menú. Recargá la página.');
      }
      onReloaded(plan, mealPlanId, refreshed);
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'No se pudieron guardar las cantidades.');
    } finally { pending.current = false; if (current()) setBusy(false); }
  }

  function update(index: number, patch: Partial<Draft>) {
    setItems((previous) => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function approveMeal(dayIndex: number, mealType: StructuredMealType) {
    setItems((previous) => previous.map((item) => {
      if (item.dayIndex !== dayIndex || item.mealType !== mealType) return item;
      const quantity = Number(item.quantityText);
      return { ...item, selected: item.quantityText.trim() !== '' && Number.isFinite(quantity) && quantity > 0 && item.unit !== null && units.includes(item.unit) };
    }));
  }

  return <section className="mt-4 rounded-xl border border-bistro-border bg-white p-4" aria-labelledby="quantity-review-title">
    <h2 id="quantity-review-title" className="font-semibold">Cantidades pendientes</h2>
    {plan.dayCount !== 7 || plan.days.length !== 7 ? <p className="mt-2 text-sm">La revisión completa de cantidades aún no está disponible para menús de más de una semana.</p> : <>
      <p className="mt-2 text-sm">Las estimaciones requieren tu revisión y no modifican el menú hasta que las guardes. El inventario incierto puede seguir requiriendo revisión.</p>
      <button type="button" onClick={prepare} disabled={disabled || busy} className="mt-3 min-h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60">{busy && !proposal ? 'Preparando…' : 'Preparar cantidades estimadas para mi menú'}</button>
      {proposal ? <div className="mt-4"><h3 className="font-semibold">Estimación de IA — revisar</h3><p className="text-sm">Aprobá solo los ingredientes que quieras guardar. Los demás seguirán pendientes.</p>
        {plan.days.map((day) => <details key={day.dayIndex} className="mt-3 rounded-lg border border-bistro-border p-3"><summary className="cursor-pointer font-semibold">{day.label}</summary>
          {day.meals.map((meal) => {
            const entries = items.map((item, index) => ({ item, index })).filter(({ item }) => item.dayIndex === day.dayIndex && item.mealType === meal.mealType);
            if (!entries.length) return null;
            return <div key={meal.mealType} className="mt-3"><h4 className="font-semibold">{labels[meal.mealType]}: {meal.title}</h4>
              <button type="button" onClick={() => approveMeal(day.dayIndex, meal.mealType)} disabled={disabled || busy} className="mt-2 min-h-11 rounded-xl border border-bistro-border px-4 text-sm font-semibold disabled:opacity-60">Aprobar cantidades válidas de este plato</button>
              {entries.map(({ item, index }) => <div key={item.ingredientIndex} className="mt-2 grid gap-2 rounded-lg bg-bistro-page p-3 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={disabled || busy} checked={item.selected} onChange={(event) => update(index, { selected: event.target.checked })} />Aprobar {item.name}</label>
                <label className="grid gap-1 text-sm">Cantidad de {item.name}<input type="number" min="0.001" step="any" value={item.quantityText} disabled={disabled || busy || meal.ingredients[item.ingredientIndex]?.quantity != null} onChange={(event) => update(index, { quantityText: event.target.value })} className="min-h-11 rounded-lg border border-bistro-border px-2" /></label>
                <label className="grid gap-1 text-sm">Unidad de {item.name}<select value={item.unit ?? ''} disabled={disabled || busy || normalizeExplicitUnit(meal.ingredients[item.ingredientIndex]?.unit ?? null) !== 'unknown'} onChange={(event) => update(index, { unit: event.target.value || null })} className="min-h-11 rounded-lg border border-bistro-border px-2"><option value="">No calculable</option>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
                {item.quantity == null || item.unit == null ? <p className="text-sm">No calculable: completá una cantidad y unidad si podés revisarlas.</p> : null}
              </div>)}
            </div>;
          })}
        </details>)}
        <p className="mt-4 text-sm" aria-live="polite">Cantidades seleccionadas: {items.filter((item) => item.selected).length}</p>
        <button type="button" onClick={save} disabled={disabled || busy || !items.some((item) => item.selected)} className="mt-4 min-h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar cantidades aprobadas'}</button>
      </div> : null}
    </>}
    {error ? <p role="alert" className="mt-3 text-sm text-bistro-danger">{error}</p> : null}
  </section>;
}
