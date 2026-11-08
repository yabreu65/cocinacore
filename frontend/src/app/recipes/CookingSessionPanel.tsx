'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';
import CookingTeacherPanel from './CookingTeacherPanel';

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
    ingredients: Array<{
      id?: string;
      name: string;
      quantity: string | null;
      unit: string | null;
    }>;
    steps: Array<{ index: number; title: string; instruction: string }>;
  };
  version: number;
};
type SessionIngredient = Session['instructionSnapshot']['ingredients'][number];
type Slot = { dayIndex: number; mealType: StructuredMealType; title: string };
type ReconciliationOutcome = 'used' | 'omitted' | 'unknown' | 'substituted';
type ReconciliationItem = {
  key: string;
  originalIngredient: string;
  outcome: ReconciliationOutcome;
  effectiveIngredient: string | null;
  quantity: number | null;
  unit: string | null;
  inventoryItemId: string | null;
  substituteIngredient: string | null;
  substituteInventoryItemId: string | null;
};
type InventoryOption = {
  id: string;
  ingredientName: string;
  normalizedName: string | null;
  quantity: string | null;
  unit: string | null;
  expirationDate: string | null;
};
type SafeFetchResult<T> = Awaited<ReturnType<typeof safeFetch<T>>>;

export async function executeCookingSessionRequest<T>(
  operation: () => Promise<SafeFetchResult<T>>,
  onSuccess: (data: T) => void,
  onError: (message: string) => void,
  onFinally: () => void,
  fallbackError: string
): Promise<void> {
  try {
    const result = await operation();
    if (result.ok) onSuccess(result.data);
    else onError(result.error);
  } catch {
    onError(fallbackError);
  } finally {
    onFinally();
  }
}

const storageKey = (recipeId: string, versionId: string) =>
  `cooking-session:${recipeId}:${versionId}`;

const startIdempotencyKey = (recipeId: string, versionId: string) =>
  `${storageKey(recipeId, versionId)}:start`;
const reconciliationIdempotencyKey = (sessionId: string) => `cooking-reconciliation:${sessionId}`;

function initialReconciliationItems(session: Session): ReconciliationItem[] {
  return stableIngredientRows(session.instructionSnapshot.ingredients).map((ingredient) => ({
    key: ingredient.key,
    originalIngredient: ingredient.name,
    outcome: 'unknown',
    effectiveIngredient: null,
    quantity: null,
    unit: null,
    inventoryItemId: null,
    substituteIngredient: null,
    substituteInventoryItemId: null,
  }));
}

export function stableIngredientRows(
  ingredients: readonly SessionIngredient[]
): Array<SessionIngredient & { key: string }> {
  const occurrences = new Map<string, number>();
  return ingredients.map((ingredient) => {
    const persistentId = ingredient.id?.trim();
    const base = [
      normalizeInventoryName(ingredient.name),
      ingredient.quantity ?? '',
      ingredient.unit ?? '',
    ].join(':');
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return {
      ...ingredient,
      key: persistentId ? `ingredient:${persistentId}` : `ingredient:${base}:${occurrence}`,
    };
  });
}

export default function CookingSessionPanel({ recipeId, versionId }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MealPlanPublicResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [reconciliationWorking, setReconciliationWorking] = useState(false);
  const [reconciliationMessage, setReconciliationMessage] = useState('');
  const loadStarted = useRef(false);
  const mountedRef = useRef(true);
  const workingRequestRef = useRef<AbortController | null>(null);
  const reconciliationRequestRef = useRef<AbortController | null>(null);
  const stableSessionIngredients = useMemo(
    () => (session ? stableIngredientRows(session.instructionSnapshot.ingredients) : []),
    [session]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workingRequestRef.current?.abort();
      reconciliationRequestRef.current?.abort();
    };
  }, []);

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
        if (!mountedRef.current) return null;
        if (storedResult?.ok) {
          setSession(storedResult.data.session);
          return null;
        }
        return safeFetch<MealPlanPublicResponse>('/api/meal-plan', { credentials: 'same-origin' });
      })
      .then((result) => {
        if (!result || !mountedRef.current) return;
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
      .catch(() => {
        if (mountedRef.current) setMessage('No se pudo recuperar la preparación.');
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, [loading, open, plan, recipeId, versionId]);

  useEffect(() => {
    if (!session || session.status !== 'completed') return;
    setReconciliationItems((current) =>
      current.length === stableSessionIngredients.length &&
      current.every((item, index) => item.key === stableSessionIngredients[index]?.key)
        ? current
        : initialReconciliationItems(session)
    );
    void safeFetch<{ inventory: InventoryOption[] }>(
      `/api/cooking-sessions/${encodeURIComponent(session.id)}/reconciliation`,
      { credentials: 'same-origin' }
    )
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.ok) setInventoryOptions(result.data.inventory);
        else setReconciliationMessage(result.error);
      })
      .catch(() => {
        if (mountedRef.current) setReconciliationMessage('No se pudo cargar el inventario.');
      });
  }, [session, stableSessionIngredients]);

  const runSessionRequest = async <T,>(
    operation: (signal: AbortSignal) => Promise<SafeFetchResult<T>>,
    onSuccess: (data: T) => void,
    fallbackError: string
  ) => {
    const controller = new AbortController();
    workingRequestRef.current?.abort();
    workingRequestRef.current = controller;
    setWorking(true);
    setMessage('');

    await executeCookingSessionRequest(
      () => operation(controller.signal),
      (data) => {
        if (mountedRef.current && !controller.signal.aborted) onSuccess(data);
      },
      (error) => {
        if (mountedRef.current && !controller.signal.aborted) setMessage(error);
      },
      () => {
        if (workingRequestRef.current === controller) {
          workingRequestRef.current = null;
          if (mountedRef.current) setWorking(false);
        }
      },
      fallbackError
    );
  };

  const start = async () => {
    if (!plan?.id || !plan.updatedAt || !plan.plan || !selectedSlot) return;
    const [dayIndexText, mealType] = selectedSlot.split(':');
    const idempotencyStorageKey = startIdempotencyKey(recipeId, versionId);
    const idempotencyKey =
      window.sessionStorage.getItem(idempotencyStorageKey) ?? crypto.randomUUID();
    window.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
    await runSessionRequest(
      (signal) =>
        safeFetch<{ status: string; session: Session }>('/api/cooking-sessions', {
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
          signal,
        }),
      (data) => {
        setSession(data.session);
        window.sessionStorage.setItem(storageKey(recipeId, versionId), data.session.id);
      },
      'No se pudo iniciar la preparación.'
    );
  };

  const transition = async (
    action: 'pause' | 'resume' | 'advance' | 'back' | 'complete' | 'cancel'
  ) => {
    if (!session) return;
    await runSessionRequest(
      (signal) =>
        safeFetch<{ session: Session }>(`/api/cooking-sessions/${session.id}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            expectedVersion: session.version,
            idempotencyKey: `${action}:${session.version}`,
            confirmed: true,
          }),
          signal,
        }),
      (data) => setSession(data.session),
      'No se pudo actualizar la preparación.'
    );
  };

  const updateReconciliationItem = (index: number, patch: Partial<ReconciliationItem>) => {
    setReconciliationItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  };

  const setReconciliationOutcome = (index: number, outcome: ReconciliationOutcome) => {
    const current = reconciliationItems[index];
    if (!current) return;
    updateReconciliationItem(index, {
      outcome,
      effectiveIngredient: outcome === 'used' ? current.originalIngredient : null,
      quantity: null,
      unit: null,
      inventoryItemId: null,
      substituteIngredient: null,
      substituteInventoryItemId: null,
    });
  };

  const submitReconciliation = async () => {
    if (!session || session.status !== 'completed') return;
    const idempotencyKey =
      window.sessionStorage.getItem(reconciliationIdempotencyKey(session.id)) ??
      crypto.randomUUID();
    window.sessionStorage.setItem(reconciliationIdempotencyKey(session.id), idempotencyKey);
    const controller = new AbortController();
    reconciliationRequestRef.current?.abort();
    reconciliationRequestRef.current = controller;
    setReconciliationWorking(true);
    setReconciliationMessage('');
    try {
      const result = await safeFetch<{ status: string; movementCount: number }>(
        `/api/cooking-sessions/${encodeURIComponent(session.id)}/reconciliation`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            expectedVersion: session.version,
            idempotencyKey,
            confirmed: true,
            items: reconciliationItems.map((item) => {
              const { key, ...payload } = item;
              void key;
              return payload;
            }),
          }),
          signal: controller.signal,
        }
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      if (result.ok) {
        setReconciliationMessage(
          result.data.status === 'already_applied'
            ? 'La reconciliación ya estaba registrada.'
            : `Uso real registrado. Movimientos de inventario: ${result.data.movementCount}.`
        );
      } else setReconciliationMessage(result.error);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setReconciliationMessage('No se pudo registrar el uso real.');
      }
    } finally {
      if (reconciliationRequestRef.current === controller) {
        reconciliationRequestRef.current = null;
        if (mountedRef.current) setReconciliationWorking(false);
      }
    }
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
                {stableSessionIngredients.map((ingredient) => (
                  <li key={ingredient.key}>
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
              <CookingTeacherPanel sessionId={session.id} />
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
              {session.status === 'completed' && (
                <fieldset className="grid gap-3 rounded-xl bg-white p-3">
                  <legend className="px-1 font-semibold">Reconciliar uso real</legend>
                  <p className="text-sm text-slate-700">
                    Confirmá qué ocurrió con cada ingrediente. Esta operación no registra consumo
                    hasta que la envíes y no puede deshacer un movimiento confirmado.
                  </p>
                  <div className="grid gap-3">
                    {reconciliationItems.map((item, index) => {
                      const matchingInventory = inventoryOptions.filter((option) => {
                        const name = item.effectiveIngredient ?? item.originalIngredient;
                        return option.normalizedName === normalizeInventoryName(name);
                      });
                      return (
                        <div
                          key={item.key}
                          className="grid gap-2 rounded-xl border border-[#D8E5D4] p-3"
                        >
                          <p className="font-medium">{item.originalIngredient}</p>
                          <label className="grid gap-1 text-sm">
                            Resultado
                            <select
                              className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                              value={item.outcome}
                              onChange={(event) =>
                                setReconciliationOutcome(
                                  index,
                                  event.target.value as ReconciliationOutcome
                                )
                              }
                            >
                              <option value="used">Usado</option>
                              <option value="omitted">Omitido</option>
                              <option value="substituted">Sustituido</option>
                              <option value="unknown">Desconocido</option>
                            </select>
                          </label>
                          {(item.outcome === 'used' || item.outcome === 'substituted') && (
                            <>
                              <label className="grid gap-1 text-sm">
                                Ingrediente efectivo
                                <input
                                  className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                                  value={item.effectiveIngredient ?? ''}
                                  onChange={(event) =>
                                    updateReconciliationItem(index, {
                                      effectiveIngredient: event.target.value,
                                    })
                                  }
                                />
                              </label>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="grid gap-1 text-sm">
                                  Cantidad efectiva
                                  <input
                                    type="number"
                                    min="0.0001"
                                    step="any"
                                    className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                                    value={item.quantity ?? ''}
                                    onChange={(event) =>
                                      updateReconciliationItem(index, {
                                        quantity: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      })
                                    }
                                  />
                                </label>
                                <label className="grid gap-1 text-sm">
                                  Unidad
                                  <input
                                    className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                                    value={item.unit ?? ''}
                                    onChange={(event) =>
                                      updateReconciliationItem(index, {
                                        unit: event.target.value || null,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              <label className="grid gap-1 text-sm">
                                Lote de inventario
                                <select
                                  className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                                  value={item.inventoryItemId ?? ''}
                                  onChange={(event) =>
                                    updateReconciliationItem(index, {
                                      inventoryItemId: event.target.value || null,
                                      ...(item.outcome === 'substituted'
                                        ? { substituteInventoryItemId: event.target.value || null }
                                        : {}),
                                    })
                                  }
                                >
                                  <option value="">Seleccioná un lote</option>
                                  {(matchingInventory.length > 0
                                    ? matchingInventory
                                    : inventoryOptions
                                  ).map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.ingredientName} · {option.quantity ?? '—'}{' '}
                                      {option.unit ?? ''}
                                      {option.expirationDate
                                        ? ` · vence ${option.expirationDate}`
                                        : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </>
                          )}
                          {item.outcome === 'substituted' && (
                            <label className="grid gap-1 text-sm">
                              Sustituto real
                              <input
                                className="rounded-xl border border-[#D8E5D4] px-3 py-2"
                                value={item.substituteIngredient ?? ''}
                                onChange={(event) =>
                                  updateReconciliationItem(index, {
                                    substituteIngredient: event.target.value,
                                    effectiveIngredient: event.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={reconciliationWorking}
                    onClick={() => void submitReconciliation()}
                    className="rounded-xl bg-[#4F6F52] px-3 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    {reconciliationWorking ? 'Registrando…' : 'Confirmar uso real'}
                  </button>
                  {reconciliationMessage && (
                    <p role="status" className="text-sm text-slate-700">
                      {reconciliationMessage}
                    </p>
                  )}
                </fieldset>
              )}
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
