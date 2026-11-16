'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import type { MealPlanPublicResponse } from '@/lib/meal-planner/rehydration';
import type { StructuredMealType } from '@/lib/meal-planner/structured-plan';
import CookingTeacherPanel from './CookingTeacherPanel';
import {
  ReconciliationSchema,
  type ReconciliationRequest,
} from '@/lib/inventory/reconciliation-request';
import {
  readPendingReconciliation,
  persistReconciliation,
  clearPendingReconciliation,
  type ReconciliationReceipt,
} from '@/lib/inventory/reconciliation-retry';

type PinnedSlot = { mealPlanId: string; dayIndex: number; mealType: StructuredMealType };
type Props = { recipeId: string; versionId: string; pinnedSlot?: PinnedSlot };
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
export function cookingSessionStatusLabel(status: Session['status']): string {
  switch (status) {
    case 'active':
      return 'En preparación';
    case 'paused':
      return 'Pausada';
    case 'completed':
      return 'Terminada';
    case 'cancelled':
      return 'Cancelada';
  }
}

type SessionIngredient = Session['instructionSnapshot']['ingredients'][number];
type Slot = { dayIndex: number; mealType: StructuredMealType; title: string };
type ReconciliationOutcome = 'used' | 'omitted' | 'unknown' | 'substituted';
type ReconciliationItem = {
  key: string;
  ingredientIndex: number;
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

export function startIdempotencyKey(recipeId: string, versionId: string, slot: PinnedSlot, revision: string) {
  return ['cooking-session', recipeId, versionId, slot.mealPlanId, slot.dayIndex, slot.mealType, revision, 'start'].join(':');
}

function sessionMatchesSlot(session: Session, recipeId: string, versionId: string, slot: PinnedSlot): boolean {
  return session.recipeId === recipeId && session.versionId === versionId &&
    session.mealPlanId === slot.mealPlanId && session.dayIndex === slot.dayIndex && session.mealType === slot.mealType;
}

const spanishMealName: Record<StructuredMealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

export function initialReconciliationItems(
  ingredients: readonly SessionIngredient[]
): ReconciliationItem[] {
  return ingredients.map((ingredient, ingredientIndex) => ({
    key: `occurrence:${ingredientIndex}`,
    ingredientIndex,
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

export default function CookingSessionPanel({ recipeId, versionId, pinnedSlot }: Props) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<MealPlanPublicResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSlot, setSelectedSlot] = useState(pinnedSlot ? pinnedSlot.dayIndex + ':' + pinnedSlot.mealType : '');
  const [slotLookup, setSlotLookup] = useState<{ key: string; ready: boolean } | null>(null);
  const [lookupRetry, setLookupRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [reconciliationItems, setReconciliationItems] = useState<ReconciliationItem[]>([]);
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [reconciliationWorking, setReconciliationWorking] = useState(false);
  const [reconciliationMessage, setReconciliationMessage] = useState('');
  const [pendingReconciliation, setPendingReconciliation] = useState<ReconciliationRequest | null>(
    null
  );
  const [receipt, setReceipt] = useState<ReconciliationReceipt | null>(null);
  const [reconciliationReady, setReconciliationReady] = useState(false);
  const [reconciliationReload, setReconciliationReload] = useState(0);
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

  const pinnedPlanId = pinnedSlot?.mealPlanId;
  const pinnedSelection = pinnedSlot ? pinnedSlot.dayIndex + ':' + pinnedSlot.mealType : '';
  const selectedPlanId = pinnedPlanId ?? plan?.id;
  const selectedIdentity = useMemo<PinnedSlot | null>(() => {
    const [day, type] = selectedSlot.split(':');
    const dayIndex = Number(day);
    if (!selectedPlanId || !Number.isInteger(dayIndex) || dayIndex < 1 ||
        (type !== 'breakfast' && type !== 'lunch' && type !== 'dinner')) return null;
    if (pinnedPlanId && selectedSlot !== pinnedSelection) return null;
    return { mealPlanId: selectedPlanId, dayIndex, mealType: type };
  }, [selectedPlanId, selectedSlot, pinnedPlanId, pinnedSelection]);
  const selectionKey = selectedIdentity ? JSON.stringify([selectedIdentity, recipeId, versionId]) : '';

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setPlan(null);
    const url = pinnedPlanId ? '/api/meal-plan?mealPlanId=' + encodeURIComponent(pinnedPlanId) : '/api/meal-plan';
    void safeFetch<MealPlanPublicResponse>(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) { setMessage(result.error); return; }
        if (pinnedPlanId && result.data.id !== pinnedPlanId) { setMessage('El menú seleccionado no está disponible.'); return; }
        setPlan(result.data);
        const matching = result.data.plan?.days.flatMap((day) => day.meals
          .filter((meal) => meal.recipeRef?.recipeId === recipeId && meal.recipeRef.versionId === versionId)
          .map((meal) => day.dayIndex + ':' + meal.mealType)) ?? [];
        setSelectedSlot((current) => pinnedSelection || (matching.includes(current) ? current : matching[0] ?? ''));
      })
      .catch(() => { if (!controller.signal.aborted) setMessage('No se pudo recuperar el menú.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, pinnedPlanId, pinnedSelection, recipeId, versionId, lookupRetry]);

  useEffect(() => {
    if (!open || !selectedIdentity) return;
    const controller = new AbortController();
    setSession(null);
    setSlotLookup({ key: selectionKey, ready: false });
    const query = new URLSearchParams({ mealPlanId: selectedIdentity.mealPlanId, dayIndex: String(selectedIdentity.dayIndex),
      mealType: selectedIdentity.mealType, recipeId, versionId });
    void safeFetch<{ session: Session | null }>('/api/cooking-sessions?' + query.toString(), { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) { setMessage(result.error); return; }
        if (result.data.session && !sessionMatchesSlot(result.data.session, recipeId, versionId, selectedIdentity)) {
          setMessage('La sesión recuperada no corresponde a la comida seleccionada.');
          return;
        }
        setSession(result.data.session);
        setSlotLookup({ key: selectionKey, ready: true });
      })
      .catch(() => { if (!controller.signal.aborted) setMessage('No se pudo recuperar la preparación.'); });
    return () => controller.abort();
  }, [open, selectedIdentity, selectionKey, recipeId, versionId, lookupRetry]);

  const lookupReady = Boolean(selectionKey && slotLookup?.key === selectionKey && slotLookup.ready);
  const selectedSession = lookupReady && session && selectedIdentity && sessionMatchesSlot(session, recipeId, versionId, selectedIdentity) ? session : null;

  useEffect(() => {
    if (!session || session.status !== 'completed') return;
    const controller = new AbortController();
    setReconciliationReady(false);
    setReceipt(null);
    setPendingReconciliation(null);
    setReconciliationMessage('');
    setInventoryOptions([]);
    setReconciliationItems(initialReconciliationItems(session.instructionSnapshot.ingredients));
    void (async () => {
      try {
        const result = await safeFetch<{
          inventory: InventoryOption[];
          receipt: ReconciliationReceipt | null;
        }>(`/api/cooking-sessions/${encodeURIComponent(session.id)}/reconciliation`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (controller.signal.aborted || !mountedRef.current) return;
        if (!result.ok) {
          setReconciliationMessage(result.error);
          return;
        }
        if (result.data.receipt) {
          setReceipt(result.data.receipt);
          // Cleanup is best effort once the durable server receipt is known.
          try {
            clearPendingReconciliation(window.sessionStorage, session.id);
          } catch {
            /* A committed receipt takes precedence over local cleanup. */
          }
          return;
        }
        if (result.data.receipt !== null || !Array.isArray(result.data.inventory))
          throw new Error('Invalid reconciliation state');
        const pending = readPendingReconciliation(window.sessionStorage, session.id);
        setPendingReconciliation(pending);
        setInventoryOptions(result.data.inventory);
        setReconciliationReady(true);
      } catch {
        if (!controller.signal.aborted && mountedRef.current)
          setReconciliationMessage(
            'No se pudo recuperar el estado del consumo. Volvé a consultar antes de confirmar.'
          );
      }
    })();
    return () => controller.abort();
  }, [session, reconciliationReload]);

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
    if (!plan?.id || !plan.updatedAt || !plan.plan || !selectedIdentity || !lookupReady || selectedSession ||
        plan.id !== selectedIdentity.mealPlanId || !slots.some((slot) => slot.dayIndex === selectedIdentity.dayIndex && slot.mealType === selectedIdentity.mealType)) return;
    const idempotencyStorageKey = startIdempotencyKey(recipeId, versionId, selectedIdentity, plan.updatedAt);
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
            dayIndex: selectedIdentity.dayIndex,
            mealType: selectedIdentity.mealType,
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
        if (!sessionMatchesSlot(data.session, recipeId, versionId, selectedIdentity)) {
          setMessage('La sesión no corresponde a la comida seleccionada.'); return;
        }
        setSession(data.session);
        window.sessionStorage.removeItem(idempotencyStorageKey);
        if (data.session.status === 'cancelled') setLookupRetry((value) => value + 1);
      },
      'No se pudo iniciar la preparación.'
    );
  };

  const transition = async (
    action: 'pause' | 'resume' | 'advance' | 'back' | 'complete' | 'cancel'
  ) => {
    if (!session || !selectedSession) return;
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
      (data) => {
        setSession(data.session);
        if (data.session.status === 'cancelled') { setMessage('Preparación cancelada.'); setLookupRetry((value) => value + 1); }
      },
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
    if (
      !session ||
      session.status !== 'completed' ||
      !reconciliationReady ||
      receipt ||
      reconciliationRequestRef.current
    )
      return;
    const controller = new AbortController();
    reconciliationRequestRef.current = controller;
    setReconciliationWorking(true);
    setReconciliationMessage('');
    try {
      // Validate and persist the full payload before sending. Never replace a
      // pending request with edits or a new session version on retry.
      const candidate =
        pendingReconciliation ??
        ReconciliationSchema.safeParse({
          expectedVersion: session.version,
          idempotencyKey: crypto.randomUUID(),
          confirmed: true,
          items: reconciliationItems.map(({ key, ...payload }) => {
            void key;
            return payload;
          }),
        });
      if ('success' in candidate && !candidate.success) {
        setReconciliationMessage('Revisá las cantidades, unidades y lotes antes de confirmar.');
        return;
      }
      const request = persistReconciliation(
        window.sessionStorage,
        session.id,
        'success' in candidate ? candidate.data : candidate
      );
      setPendingReconciliation(request);
      const url = `/api/cooking-sessions/${encodeURIComponent(session.id)}/reconciliation`;
      const result = await safeFetch<ReconciliationReceipt & { status: string }>(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      if (result.ok) {
        setReceipt({
          operationId: result.data.operationId,
          movementCount: result.data.movementCount,
        });
        setPendingReconciliation(null);
        setReconciliationReady(false);
        try {
          clearPendingReconciliation(window.sessionStorage, session.id);
        } catch {
          // A committed receipt takes precedence over local cleanup.
        }
        setReconciliationMessage(
          result.data.status === 'already_applied'
            ? 'La reconciliación ya estaba registrada.'
            : 'Uso real registrado.'
        );
        return;
      }
      // A definitive domain/validation rejection permits editing only after
      // checking for an already committed receipt. Ambiguous errors retain
      // the exact pending request for replay.
      if (result.status === 400 || result.status === 409) {
        const state = await safeFetch<{
          inventory: InventoryOption[];
          receipt: ReconciliationReceipt | null;
        }>(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        if (state.ok) {
          if (state.data.receipt) {
            setReceipt(state.data.receipt);
            setReconciliationReady(false);
            setReconciliationMessage('La reconciliación ya estaba registrada.');
            try {
              clearPendingReconciliation(window.sessionStorage, session.id);
            } catch {
              /* Receipt remains authoritative. */
            }
            setPendingReconciliation(null);
            return;
          } else if (state.data.receipt === null && Array.isArray(state.data.inventory)) {
            setInventoryOptions(state.data.inventory);
            setReconciliationItems(
              request.items.map((item, index) => ({
                ...item,
                ingredientIndex: item.ingredientIndex ?? index,
                key: `occurrence:${item.ingredientIndex ?? index}`,
              }))
            );
            clearPendingReconciliation(window.sessionStorage, session.id);
            setPendingReconciliation(null);
          }
        }
      }
      setReconciliationMessage(result.error);
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        setReconciliationMessage(
          'No se pudo confirmar el resultado. Consultá o reintentá el consumo guardado.'
        );
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
        disabled={working || reconciliationWorking}
        onClick={() => { if (!open) { setSlotLookup(null); setMessage(''); } setOpen((value) => !value); }}
        className="rounded-xl border border-bistro-action-secondary px-3 py-2 text-sm font-semibold text-bistro-action-secondary"
        aria-expanded={open}
      >
        {open ? 'Cerrar preparación' : 'Preparar esta receta'}
      </button>
      {open && (
        <div className="mt-3 grid gap-3 rounded-2xl bg-bistro-surface-warm p-3">
          {loading && <p role="status">Recuperando preparación…</p>}
          {!loading && !selectedSession && slots.length === 0 && !pinnedSlot && (
            <div className="rounded-xl border border-bistro-border bg-white p-4 text-sm text-bistro-text-secondary">
              <p className="font-semibold text-bistro-text-primary">
                Esta receta todavía no está vinculada a una comida del menú.
              </p>
              <p className="mt-2">
                Para usar el seguimiento de preparación, primero asociá esta receta a un menú. Si
                solo querés cocinarla ahora, podés consultar sus ingredientes y pasos.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <Link
                  href="/meal-planner"
                  className="inline-flex min-h-11 items-center rounded-xl bg-bistro-action-secondary px-4 py-2 font-semibold text-white"
                >
                  Ir al planificador
                </Link>
                <Link
                  href={`/recipes/${encodeURIComponent(recipeId)}`}
                  className="inline-flex min-h-11 items-center rounded-xl border border-bistro-border px-4 py-2 font-semibold text-bistro-action-primary"
                >
                  Ver receta y pasos
                </Link>
              </div>
            </div>
          )}
          {!loading && pinnedSlot && <p className="text-sm font-semibold">Día {pinnedSlot.dayIndex} · {spanishMealName[pinnedSlot.mealType]}</p>}
          {!loading && slots.length > 0 && !pinnedSlot && (
            <>
              <label className="grid gap-1 text-sm font-semibold">
                Comida asociada del menú
                <select
                  className="rounded-xl border border-bistro-border bg-white px-3 py-2"
                  value={selectedSlot}
                  disabled={working || reconciliationWorking}
                  onChange={(event) => { setSession(null); setSlotLookup(null); setMessage(''); setSelectedSlot(event.target.value); }}
                >
                  {slots.map((slot) => (
                    <option
                      key={`${slot.dayIndex}:${slot.mealType}`}
                      value={`${slot.dayIndex}:${slot.mealType}`}
                    >
                      Día {slot.dayIndex} · {spanishMealName[slot.mealType]} · {slot.title}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {!loading && lookupReady && !selectedSession && plan?.id === selectedPlanId && slots.some((slot) => slot.dayIndex + ':' + slot.mealType === selectedSlot) && (
              <button
                type="button"
                disabled={working || !selectedSlot}
                onClick={() => void start()}
                className="rounded-xl bg-bistro-action-secondary px-3 py-2 font-semibold text-white disabled:opacity-50"
              >
                {working ? 'Iniciando…' : 'Iniciar preparación'}
              </button>
          )}
          {!loading && selectedIdentity && (!lookupReady || (!selectedSession && !plan)) && (
            <button type="button" disabled={working} onClick={() => setLookupRetry((value) => value + 1)} className="text-sm underline">Consultar preparación</button>
          )}
          {!loading && selectedSession && session && (
            <>
              <p role="status" className="font-semibold">
                Paso {session.currentStep} de {session.totalSteps} ·{' '}
                {cookingSessionStatusLabel(session.status)}
              </p>
              <p className="text-sm">
                Porciones de la receta original: {session.instructionSnapshot.servings ?? '—'}
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
                    className="rounded-xl bg-bistro-action-secondary px-3 py-2 text-sm font-semibold text-white"
                  >
                    Finalizar
                  </button>
                )}
                {(session.status === 'active' || session.status === 'paused') && (
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void transition('cancel')}
                    className="rounded-xl border border-bistro-danger/30 px-3 py-2 text-sm text-bistro-danger"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              {session.status === 'completed' && (
                <fieldset className="grid gap-3 rounded-xl bg-white p-3">
                  <legend className="px-1 font-semibold">Reconciliar uso real</legend>
                  <p className="text-sm text-bistro-text-secondary">
                    Confirmá qué ocurrió con cada ingrediente. Esta operación no registra consumo
                    hasta que la envíes y no puede deshacer un movimiento confirmado.
                  </p>
                  {receipt ? (
                    <p role="status" className="text-sm font-semibold text-bistro-text-primary">
                      Uso real registrado. Movimientos de inventario: {receipt.movementCount}.
                    </p>
                  ) : !reconciliationReady ? (
                    <button
                      type="button"
                      onClick={() => setReconciliationReload((n) => n + 1)}
                      className="rounded-xl border border-bistro-border px-3 py-2"
                    >
                      Consultar estado del consumo
                    </button>
                  ) : pendingReconciliation ? (
                    <>
                      <p role="status" className="text-sm text-bistro-text-secondary">
                        Hay un consumo pendiente de confirmación. El reintento enviará exactamente
                        los datos guardados, sin duplicar movimientos.
                      </p>
                      <button
                        type="button"
                        disabled={reconciliationWorking}
                        onClick={() => setReconciliationReload((n) => n + 1)}
                        className="rounded-xl border border-bistro-border px-3 py-2"
                      >
                        Consultar estado del consumo
                      </button>
                    </>
                  ) : (
                    <fieldset disabled={reconciliationWorking} className="grid gap-3">
                      {reconciliationItems.map((item, index) => {
                        const matchingInventory = inventoryOptions.filter((option) => {
                          const name = item.effectiveIngredient ?? item.originalIngredient;
                          return (
                            normalizeInventoryName(option.ingredientName) ===
                            normalizeInventoryName(name)
                          );
                        });
                        return (
                          <div
                            key={item.key}
                            className="grid gap-2 rounded-xl border border-bistro-border p-3"
                          >
                            <p className="font-medium">
                              {item.ingredientIndex + 1}. {item.originalIngredient} ·{' '}
                              {session.instructionSnapshot.ingredients[item.ingredientIndex]
                                ?.quantity ?? '—'}{' '}
                              {session.instructionSnapshot.ingredients[item.ingredientIndex]
                                ?.unit ?? ''}
                            </p>
                            <label className="grid gap-1 text-sm">
                              Resultado
                              <select
                                className="rounded-xl border border-bistro-border px-3 py-2"
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
                                    className="rounded-xl border border-bistro-border px-3 py-2"
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
                                      className="rounded-xl border border-bistro-border px-3 py-2"
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
                                      className="rounded-xl border border-bistro-border px-3 py-2"
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
                                    className="rounded-xl border border-bistro-border px-3 py-2"
                                    value={item.inventoryItemId ?? ''}
                                    onChange={(event) =>
                                      updateReconciliationItem(index, {
                                        inventoryItemId: event.target.value || null,
                                        ...(item.outcome === 'substituted'
                                          ? {
                                              substituteInventoryItemId: event.target.value || null,
                                            }
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
                                  className="rounded-xl border border-bistro-border px-3 py-2"
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
                    </fieldset>
                  )}
                  {!receipt && reconciliationReady && (
                    <button
                      type="button"
                      disabled={
                        reconciliationWorking ||
                        (!pendingReconciliation && reconciliationItems.length === 0)
                      }
                      onClick={() => void submitReconciliation()}
                      className="rounded-xl bg-bistro-action-secondary px-3 py-2 font-semibold text-white disabled:opacity-50"
                    >
                      {reconciliationWorking
                        ? 'Registrando…'
                        : pendingReconciliation
                          ? 'Reintentar consumo guardado'
                          : 'Confirmar uso real'}
                    </button>
                  )}
                  {reconciliationMessage && (
                    <p role="status" className="text-sm text-bistro-text-secondary">
                      {reconciliationMessage}
                    </p>
                  )}
                </fieldset>
              )}
            </>
          )}
          {message && (
            <p role="alert" className="text-sm text-bistro-danger">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
