'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';

type Props = { recipeId: string; versionId: string };
type Session = {
  id: string;
  mealPlanId: string;
  dayIndex: number;
  mealType: StructuredMealType;
  recipeId: string;
  versionId: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  instructionSnapshot: {
    servings: number | null;
    ingredients: Array<{ name: string; quantity: string | null; unit: string | null }>;
    steps: Array<{ index: number; title: string; instruction: string }>;
  };
  version: number;
};
type Slot = { dayIndex: number; mealType: StructuredMealType; title: string };

const storageKey = (recipeId: string, versionId: string) =>
  `cooking-session:${recipeId}:${versionId}`;

const startIdempotencyKey = (recipeId: string, versionId: string) =>
  `${storageKey(recipeId, versionId)}:start`;

export default function CookingSessionPanel({ recipeId, versionId }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MealPlanPublicResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const loadStarted = useRef(false);

  const slots = useMemo<Slot[]>(
    () =>
      plan?.plan?.days.flatMap((day) =>
        day.meals
          .filter(
            (meal) =>
              meal.recipeRef?.recipeId === recipeId && meal.recipeRef.versionId === versionId
          )
          .map((meal) => ({ dayIndex: day.dayIndex, mealType: meal.mealType, title: meal.title }))
      ) ?? [],
    [plan, recipeId, versionId]
  );

  useEffect(() => {
    if (!open) {
      loadStarted.current = false;
      return;
    }
    if (loadStarted.current || loading || plan) return;
    loadStarted.current = true;
    setLoading(true);
    const stored = window.sessionStorage.getItem(storageKey(recipeId, versionId));
    const load = stored
      ? safeFetch<{ session: Session }>(`/api/cooking-sessions/${encodeURIComponent(stored)}`)
      : Promise.resolve(null);
    void load
      .then((storedResult) => {
        if (storedResult?.ok) {
          setSession(storedResult.data.session);
          return null;
        }
        return safeFetch<MealPlanPublicResponse>('/api/meal-plan', { credentials: 'same-origin' });
      })
      .then((result) => {
        if (!result) return;
        if (!result.ok) {
          setMessage(result.error);
          return;
        }
        setPlan(result.data);
        const first = result.data.plan?.days
          .flatMap((day) => day.meals)
          .find(
            (meal) =>
              meal.recipeRef?.recipeId === recipeId && meal.recipeRef.versionId === versionId
          );
        if (first && result.data.plan) {
          const day = result.data.plan.days.find((candidate) => candidate.meals.includes(first));
          if (day) setSelectedSlot(`${day.dayIndex}:${first.mealType}`);
        }
      })
      .catch(() => setMessage('No se pudo recuperar la preparación.'))
      .finally(() => setLoading(false));
  }, [loading, open, plan, recipeId, versionId]);

  const start = async () => {
    if (!plan?.id || !plan.updatedAt || !plan.plan || !selectedSlot) return;
    const [dayIndexText, mealType] = selectedSlot.split(':');
    const idempotencyStorageKey = startIdempotencyKey(recipeId, versionId);
    const idempotencyKey =
      window.sessionStorage.getItem(idempotencyStorageKey) ?? crypto.randomUUID();
    window.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
    setWorking(true);
    setMessage('');
    const result = await safeFetch<{ status: string; session: Session }>('/api/cooking-sessions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mealPlanId: plan.id,
        dayIndex: Number(dayIndexText),
        mealType,
        recipeId,
        versionId,
        expectedUpdatedAt: plan.updatedAt,
        expectedCalendarPayload: plan.plan,
        idempotencyKey,
        confirmed: true,
      }),
    });
    if (result.ok) {
      setSession(result.data.session);
      window.sessionStorage.setItem(storageKey(recipeId, versionId), result.data.session.id);
    } else setMessage(result.error);
    setWorking(false);
  };

  const transition = async (
    action: 'pause' | 'resume' | 'advance' | 'back' | 'complete' | 'cancel'
  ) => {
    if (!session) return;
    setWorking(true);
    setMessage('');
    const result = await safeFetch<{ session: Session }>(`/api/cooking-sessions/${session.id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        expectedVersion: session.version,
        idempotencyKey: `${action}:${session.version}`,
        confirmed: true,
      }),
    });
    if (result.ok) setSession(result.data.session);
    else setMessage(result.error);
    setWorking(false);
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-xl border border-[#4F6F52] px-3 py-2 text-sm font-semibold text-[#355238]"
        aria-expanded={open}
      >
        {open ? 'Cerrar preparación' : 'Preparar esta receta'}
      </button>
      {open && (
        <div className="mt-3 grid gap-3 rounded-2xl bg-[#F2F7F0] p-3">
          {loading && <p role="status">Recuperando preparación…</p>}
          {!loading && !session && slots.length === 0 && (
            <p>No hay un slot confirmado asociado a esta receta.</p>
          )}
          {!loading && !session && slots.length > 0 && (
            <>
              <label className="grid gap-1 text-sm font-semibold">
                Slot asociado
                <select
                  className="rounded-xl border border-[#D8E5D4] bg-white px-3 py-2"
                  value={selectedSlot}
                  onChange={(event) => setSelectedSlot(event.target.value)}
                >
                  {slots.map((slot) => (
                    <option
                      key={`${slot.dayIndex}:${slot.mealType}`}
                      value={`${slot.dayIndex}:${slot.mealType}`}
                    >
                      Día {slot.dayIndex} · {slot.mealType} · {slot.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={working || !selectedSlot}
                onClick={() => void start()}
                className="rounded-xl bg-[#4F6F52] px-3 py-2 font-semibold text-white disabled:opacity-50"
              >
                {working ? 'Iniciando…' : 'Iniciar preparación'}
              </button>
            </>
          )}
          {!loading && session && (
            <>
              <p role="status" className="font-semibold">
                Paso {session.currentStep} de {session.totalSteps} · {session.status}
              </p>
              <p className="text-sm">
                Porciones previstas: {session.instructionSnapshot.servings ?? '—'}
              </p>
              <ul aria-label="Ingredientes previstos" className="grid gap-1 text-sm">
                {session.instructionSnapshot.ingredients.map((ingredient) => (
                  <li key={`${ingredient.name}:${ingredient.quantity}:${ingredient.unit}`}>
                    {[ingredient.quantity, ingredient.unit, ingredient.name]
                      .filter(Boolean)
                      .join(' ') || 'Cantidad desconocida'}
                  </li>
                ))}
              </ul>
              <div className="rounded-xl bg-white p-3">
                <h3 className="font-semibold">
                  {session.instructionSnapshot.steps[session.currentStep - 1]?.title}
                </h3>
                <p className="mt-1 text-sm">
                  {session.instructionSnapshot.steps[session.currentStep - 1]?.instruction}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {session.status === 'active' && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('pause')}
                    className="rounded-xl border px-3 py-2 text-sm"
                  >
                    Pausar
                  </button>
                )}
                {session.status === 'paused' && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('resume')}
                    className="rounded-xl border px-3 py-2 text-sm"
                  >
                    Reanudar
                  </button>
                )}
                {session.status === 'active' && (
                  <button
                    type="button"
                    disabled={working || session.currentStep === 1}
                    onClick={() => void transition('back')}
                    className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Anterior
                  </button>
                )}
                {session.status === 'active' && session.currentStep < session.totalSteps && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('advance')}
                    className="rounded-xl border px-3 py-2 text-sm"
                  >
                    Siguiente
                  </button>
                )}
                {session.status === 'active' && session.currentStep === session.totalSteps && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('complete')}
                    className="rounded-xl bg-[#4F6F52] px-3 py-2 text-sm font-semibold text-white"
                  >
                    Finalizar
                  </button>
                )}
                {(session.status === 'active' || session.status === 'paused') && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('cancel')}
                    className="rounded-xl border border-red-300 px-3 py-2 text-sm text-red-800"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </>
          )}
          {message && (
            <p role="alert" className="text-sm text-red-800">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
