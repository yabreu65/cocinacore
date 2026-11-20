'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import {
  rehydrateMealPlanner,
  shouldApplyMealPlannerRehydration,
  shouldApplyMealPlannerSuggestions,
  type MealPlanPublicResponse,
} from '@/lib/meal-planner/rehydration';
import type { StructuredMealPlan, StructuredMealType } from '@/lib/meal-planner/structured-plan';
import type { AdaptivePlanProposal } from '@/lib/meal-planner/adaptive-planning';
import { mapMealPlanLoadError } from '@/lib/meal-planner/meal-plan-load-error';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import {
  mealConsumptionKey,
  type MealConsumptionPayload,
  type MealConsumptionRecord,
} from '@/lib/meal-planner/consumption';
import { shouldApplyConsumptionResponse, withConsumptionRecord } from './consumptionState';
import LoadErrorNotice from './load-error-notice';
import MealPreparationAction from './MealPreparationAction';
import ScheduleConfirmation from './ScheduleConfirmation';

type ShoppingSuggestion = {
  normalizedName: string;
  ingredientName: string;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  quantityToBuy: number | null;
  unit: string;
  status: 'buy' | 'review';
  usedInRecipes: string[];
  estimatedCost: number | null;
  alreadyPresent: boolean;
  shoppingStatus: 'pending' | 'purchased' | null;
  transferCompleted: boolean;
  existingShoppingSources: string[];
};

type ShoppingCost = {
  status: 'complete' | 'partial' | 'unknown';
  estimatedTotal: number | null;
  knownItemCount: number;
  itemCount: number;
};

type ConfirmationItem = {
  ingredient_name: string;
  status: 'pending' | 'purchased';
};

const mealTypeLabels: Record<StructuredMealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
};

export default function MealPlannerPage() {
  const [peopleCount, setPeopleCount] = useState(4);
  const [planPeopleCount, setPlanPeopleCount] = useState(4);
  const [period, setPeriod] = useState<'week' | 'fortnight' | 'month'>('week');
  const [baseCuisine, setBaseCuisine] = useState('');
  const [restrictions, setRestrictions] = useState('');
  // Snapshot from the saved plan, not the currently editable form field.
  const [planHardRestrictions, setPlanHardRestrictions] = useState<string[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StructuredMealPlan | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [adaptiveProposal, setAdaptiveProposal] = useState<AdaptivePlanProposal | null>(null);
  const [adaptiveExpectedUpdatedAt, setAdaptiveExpectedUpdatedAt] = useState<string | null>(null);
  const [adaptiveSourceFingerprint, setAdaptiveSourceFingerprint] = useState<string | null>(null);
  const [isLoadingAdaptive, setIsLoadingAdaptive] = useState(false);
  const [isConfirmingAdaptive, setIsConfirmingAdaptive] = useState(false);
  const [adaptiveMessage, setAdaptiveMessage] = useState<string | null>(null);
  const [adaptiveError, setAdaptiveError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [shoppingMessage, setShoppingMessage] = useState<string | null>(null);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const [shoppingHorizon, setShoppingHorizon] = useState<7 | 14>(7);
  const shoppingHorizonRef = useRef<7 | 14>(7);
  const [shoppingStatus, setShoppingStatus] = useState<'ready' | 'unknown'>('ready');
  const [shoppingReason, setShoppingReason] = useState<string | null>(null);
  const [shoppingExpectedUpdatedAt, setShoppingExpectedUpdatedAt] = useState<string | null>(null);
  const [shoppingFingerprint, setShoppingFingerprint] = useState<string | null>(null);
  const [shoppingCost, setShoppingCost] = useState<ShoppingCost | null>(null);
  const [consumptions, setConsumptions] = useState<MealConsumptionPayload>({});
  const [isLoadingConsumptions, setIsLoadingConsumptions] = useState(false);
  const [consumingMealKeys, setConsumingMealKeys] = useState<Set<string>>(new Set());
  const [consumptionMessage, setConsumptionMessage] = useState<string | null>(null);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);
  const planRef = useRef(plan);
  const generationStartedRef = useRef(false);
  const activePlanIdRef = useRef<string | null>(null);
  const suggestionRequestVersionRef = useRef(0);
  const consumptionRequestVersionRef = useRef(0);
  const adaptiveRequestVersionRef = useRef(0);
  const componentActiveRef = useRef(true);
  const userEditedRef = useRef(false);

  const setCurrentPlan = (next: StructuredMealPlan | null) => {
    planRef.current = next;
    setPlan(next);
  };

  const loadSuggestions = useCallback(
    async (mealPlanId: string, preserveMessage = false, horizonDays: 7 | 14 = shoppingHorizonRef.current) => {
      const requestVersion = ++suggestionRequestVersionRef.current;
      setIsLoadingSuggestions(true);
      setShoppingError(null);
      if (!preserveMessage) setShoppingMessage(null);
      try {
        const result = await safeFetch<{
          items: ShoppingSuggestion[];
          status: 'ready' | 'unknown';
          reason?: string;
          expectedUpdatedAt: string;
          sourceFingerprint: string;
          cost: ShoppingCost;
        }>(
          `/api/meal-plan/shopping-suggestions?mealPlanId=${encodeURIComponent(mealPlanId)}&horizon=${horizonDays}`,
          { credentials: 'same-origin' }
        );
        if (!result.ok) throw new Error(result.error ?? 'No se pudieron cargar los faltantes.');
        if (
          !shouldApplyMealPlannerSuggestions({
            componentActive: componentActiveRef.current,
            requestVersion,
            latestRequestVersion: suggestionRequestVersionRef.current,
            activePlanId: activePlanIdRef.current,
            mealPlanId,
          })
        )
          return;
        setShoppingStatus(result.data.status);
        setShoppingReason(result.data.reason ?? null);
        setShoppingExpectedUpdatedAt(result.data.expectedUpdatedAt);
        setShoppingFingerprint(result.data.sourceFingerprint);
        setShoppingCost(result.data.cost);
        setSuggestions(result.data.items);
        setSelectedItems(
          new Set(
            result.data.items
              .filter((item) => item.status === 'buy' && !item.alreadyPresent)
              .map((item) => item.normalizedName)
          )
        );
      } catch (error) {
        if (
          componentActiveRef.current &&
          suggestionRequestVersionRef.current === requestVersion &&
          activePlanIdRef.current === mealPlanId
        ) {
          setShoppingError(
            error instanceof Error ? error.message : 'No se pudieron cargar los faltantes.'
          );
          setShoppingStatus('unknown');
          setShoppingReason(null);
          setShoppingExpectedUpdatedAt(null);
          setShoppingFingerprint(null);
          setShoppingCost(null);
          setSuggestions([]);
          setSelectedItems(new Set());
        }
      } finally {
        if (componentActiveRef.current && suggestionRequestVersionRef.current === requestVersion) {
          setIsLoadingSuggestions(false);
        }
      }
    },
    []
  );

  const loadConsumptions = useCallback(async (mealPlanId: string) => {
    const requestVersion = ++consumptionRequestVersionRef.current;
    setIsLoadingConsumptions(true);
    setConsumptionError(null);
    try {
      const result = await safeFetch<{ consumptions: MealConsumptionPayload }>(
        `/api/meal-plan/consumption?mealPlanId=${encodeURIComponent(mealPlanId)}`,
        { credentials: 'same-origin' }
      );
      if (!result.ok) throw new Error(result.error ?? 'No se pudo cargar el estado de comidas.');
      if (
        !shouldApplyConsumptionResponse({
          componentActive: componentActiveRef.current,
          requestVersion,
          latestRequestVersion: consumptionRequestVersionRef.current,
          activePlanId: activePlanIdRef.current,
          mealPlanId,
        })
      )
        return;
      setConsumptions(result.data.consumptions);
    } catch (error) {
      if (
        componentActiveRef.current &&
        consumptionRequestVersionRef.current === requestVersion &&
        activePlanIdRef.current === mealPlanId
      ) {
        setConsumptionError(
          error instanceof Error ? error.message : 'No se pudo cargar el estado de comidas.'
        );
      }
    } finally {
      if (componentActiveRef.current && consumptionRequestVersionRef.current === requestVersion) {
        setIsLoadingConsumptions(false);
      }
    }
  }, []);

  const onRequestAdaptiveProposal = async () => {
    if (!activePlanId || isLoadingAdaptive || isConfirmingAdaptive) return;
    const mealPlanId = activePlanId;
    const requestVersion = ++adaptiveRequestVersionRef.current;
    setIsLoadingAdaptive(true);
    setAdaptiveError(null);
    setAdaptiveMessage(null);
    try {
      const result = await safeFetch<{
        expectedUpdatedAt: string;
        sourceFingerprint: string;
        proposal: AdaptivePlanProposal;
      }>('/api/meal-plan/adaptive-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mealPlanId: activePlanId }),
      });
      if (!result.ok) throw new Error(result.error ?? 'No se pudo preparar la propuesta.');
      if (
        !componentActiveRef.current ||
        activePlanIdRef.current !== mealPlanId ||
        adaptiveRequestVersionRef.current !== requestVersion
      )
        return;
      setAdaptiveProposal(result.data.proposal);
      setAdaptiveExpectedUpdatedAt(result.data.expectedUpdatedAt);
      setAdaptiveSourceFingerprint(result.data.sourceFingerprint);
    } catch (error) {
      if (
        componentActiveRef.current &&
        activePlanIdRef.current === mealPlanId &&
        adaptiveRequestVersionRef.current === requestVersion
      ) {
        setAdaptiveError(
          error instanceof Error ? error.message : 'No se pudo preparar la propuesta.'
        );
      }
    } finally {
      if (componentActiveRef.current && adaptiveRequestVersionRef.current === requestVersion) {
        setIsLoadingAdaptive(false);
      }
    }
  };

  const onConfirmAdaptiveProposal = async () => {
    if (
      !activePlanId ||
      !adaptiveProposal ||
      !adaptiveExpectedUpdatedAt ||
      !adaptiveSourceFingerprint ||
      isConfirmingAdaptive ||
      isLoadingAdaptive
    )
      return;
    if (isLoadingConsumptions || consumingMealKeys.size > 0) {
      setAdaptiveError('Esperá a que termine el registro de la comida antes de confirmar.');
      return;
    }
    const mealPlanId = activePlanId;
    const requestVersion = ++adaptiveRequestVersionRef.current;
    setIsConfirmingAdaptive(true);
    setAdaptiveError(null);
    setAdaptiveMessage(null);
    try {
      const result = await safeFetch<{ plan: StructuredMealPlan }>(
        '/api/meal-plan/adaptive-proposal/confirm',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            mealPlanId: activePlanId,
            expectedUpdatedAt: adaptiveExpectedUpdatedAt,
            sourceFingerprint: adaptiveSourceFingerprint,
            proposedPlan: adaptiveProposal.plan,
          }),
        }
      );
      if (!result.ok) throw new Error(result.error ?? 'La propuesta quedó desactualizada.');
      if (
        !componentActiveRef.current ||
        activePlanIdRef.current !== mealPlanId ||
        adaptiveRequestVersionRef.current !== requestVersion
      )
        return;
      setCurrentPlan(result.data.plan);
      setAdaptiveProposal(null);
      setAdaptiveExpectedUpdatedAt(null);
      setAdaptiveSourceFingerprint(null);
      setAdaptiveMessage(
        'Propuesta confirmada. El menú guardado fue actualizado sin descontar inventario.'
      );
      void loadSuggestions(mealPlanId, true);
    } catch (error) {
      if (
        componentActiveRef.current &&
        activePlanIdRef.current === mealPlanId &&
        adaptiveRequestVersionRef.current === requestVersion
      ) {
        setAdaptiveError(
          error instanceof Error ? error.message : 'No se pudo confirmar la propuesta.'
        );
      }
    } finally {
      if (componentActiveRef.current && adaptiveRequestVersionRef.current === requestVersion) {
        setIsConfirmingAdaptive(false);
      }
    }
  };

  useEffect(() => {
    let active = true;
    componentActiveRef.current = true;

    const loadLatestMealPlan = async () => {
      try {
        const result = await safeFetch<MealPlanPublicResponse>('/api/meal-plan', {
          credentials: 'same-origin',
        });
        if (!result.ok) {
          throw new Error(mapMealPlanLoadError(result.error));
        }
        if (
          !shouldApplyMealPlannerRehydration({
            active,
            generationStarted: generationStartedRef.current,
            userEdited: userEditedRef.current,
          })
        ) {
          return;
        }

        const restored = rehydrateMealPlanner(result.data);
        const restoredPlanId =
          restored.plan && typeof result.data.id === 'string' ? result.data.id : null;
        activePlanIdRef.current = restoredPlanId;
        setActivePlanId(restoredPlanId);
        setPeopleCount(restored.peopleCount);
        setPlanPeopleCount(restored.peopleCount);
        setPeriod(restored.period);
        setBaseCuisine(restored.baseCuisine);
        setRestrictions(restored.restrictions);
        setPlanHardRestrictions(result.data.restrictions ?? []);
        setCurrentPlan(restored.plan);
        if (restoredPlanId) {
          void loadSuggestions(restoredPlanId);
          void loadConsumptions(restoredPlanId);
        }
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
      componentActiveRef.current = false;
      suggestionRequestVersionRef.current += 1;
      consumptionRequestVersionRef.current += 1;
    };
  }, [loadConsumptions, loadSuggestions]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    generationStartedRef.current = true;
    adaptiveRequestVersionRef.current += 1;
    suggestionRequestVersionRef.current += 1;
    consumptionRequestVersionRef.current += 1;
    activePlanIdRef.current = null;
    setActivePlanId(null);
    setPlanHardRestrictions([]);
    setIsLoadingSuggestions(false);
    setSuggestions([]);
    setSelectedItems(new Set());
    setShoppingMessage(null);
    setShoppingError(null);
    setShoppingStatus('ready');
    setShoppingReason(null);
    setShoppingExpectedUpdatedAt(null);
    setShoppingFingerprint(null);
    setShoppingCost(null);
    setConsumptions({});
    setIsLoadingConsumptions(false);
    setConsumingMealKeys(new Set());
    setConsumptionMessage(null);
    setConsumptionError(null);
    setIsConfirming(false);
    setAdaptiveProposal(null);
    setAdaptiveExpectedUpdatedAt(null);
    setAdaptiveSourceFingerprint(null);
    setAdaptiveMessage(null);
    setAdaptiveError(null);
    setIsLoadingAdaptive(false);
    setIsConfirmingAdaptive(false);
    setIsGenerating(true);
    setGenerationError(null);
    setCurrentPlan(null);

    try {
      const result = await safeFetch<{ id?: string; plan?: StructuredMealPlan; content?: string }>(
        '/api/meal-plan',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            peopleCount,
            period,
            baseCuisine: baseCuisine || 'Latinoamericana',
            fusionCuisines: [],
            fusionIntensity: 'media',
            restrictions: restrictions
              .split(',')
              .map((restriction) => restriction.trim())
              .filter(Boolean),
            mode: 'balanced_ai',
          }),
        }
      );

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo generar el menú.');
      }

      if (!result.data.plan) {
        throw new Error('El proveedor IA no devolvió un menú estructurado.');
      }
      setCurrentPlan(result.data.plan);
      setPlanPeopleCount(peopleCount);
      setPlanHardRestrictions(restrictions.split(',').map((value) => value.trim()).filter(Boolean));
      const generatedPlanId = typeof result.data.id === 'string' ? result.data.id : null;
      activePlanIdRef.current = generatedPlanId;
      setActivePlanId(generatedPlanId);
      if (generatedPlanId) {
        void loadSuggestions(generatedPlanId);
        void loadConsumptions(generatedPlanId);
      }
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setIsGenerating(false);
    }
  };

  const onConfirmSelected = async () => {
    if (
      !activePlanId ||
      selectedItems.size === 0 ||
      isConfirming ||
      !shoppingExpectedUpdatedAt ||
      !shoppingFingerprint
    )
      return;
    const mealPlanId = activePlanId;
    const requestVersion = ++suggestionRequestVersionRef.current;
    setIsConfirming(true);
    setShoppingError(null);
    setShoppingMessage(null);
    try {
      const result = await safeFetch<{
        added: ConfirmationItem[];
        alreadyPresent: ConfirmationItem[];
        ignored: string[];
      }>('/api/meal-plan/shopping-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          mealPlanId,
          horizonDays: shoppingHorizon,
          selectedItems: [...selectedItems],
          expectedUpdatedAt: shoppingExpectedUpdatedAt,
          expectedFingerprint: shoppingFingerprint,
        }),
      });
      if (!result.ok) throw new Error(result.error ?? 'No se pudieron agregar los artículos.');
      if (
        !componentActiveRef.current ||
        activePlanIdRef.current !== mealPlanId ||
        suggestionRequestVersionRef.current !== requestVersion
      )
        return;

      const confirmed = new Map<string, 'pending' | 'purchased'>();
      for (const item of [...result.data.added, ...result.data.alreadyPresent]) {
        confirmed.set(normalizeInventoryName(item.ingredient_name), item.status);
      }
      setSuggestions((current) =>
        current.map((item) => {
          const status = confirmed.get(item.normalizedName);
          return status ? { ...item, alreadyPresent: true, shoppingStatus: status } : item;
        })
      );
      setSelectedItems((current) => new Set([...current].filter((name) => !confirmed.has(name))));
      const parts: string[] = [];
      if (result.data.added.length) {
        parts.push(
          `Se agregaron ${result.data.added.length} ${result.data.added.length === 1 ? 'artículo' : 'artículos'}.`
        );
      }
      if (result.data.alreadyPresent.length) {
        parts.push(
          `${result.data.alreadyPresent.length} ${result.data.alreadyPresent.length === 1 ? 'ya estaba' : 'ya estaban'} en compras.`
        );
      }
      if (result.data.ignored.length) {
        parts.push(`Se ignoraron claves desactualizadas: ${result.data.ignored.join(', ')}.`);
      }
      setShoppingMessage(parts.join(' ') || 'No hubo artículos nuevos para agregar.');
      void loadSuggestions(mealPlanId, true);
    } catch (error) {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId) {
        setShoppingError(
          error instanceof Error ? error.message : 'No se pudieron agregar los artículos.'
        );
      }
    } finally {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId)
        setIsConfirming(false);
    }
  };

  const onConfirmMealConsumed = async (dayIndex: number, mealType: StructuredMealType) => {
    if (!activePlanId) return;
    const mealPlanId = activePlanId;
    const key = mealConsumptionKey(dayIndex, mealType);
    if (consumptions[key] || consumingMealKeys.has(key)) return;

    consumptionRequestVersionRef.current += 1;
    setIsLoadingConsumptions(false);
    setConsumingMealKeys((current) => new Set(current).add(key));
    setConsumptionError(null);
    setConsumptionMessage(null);
    try {
      const result = await safeFetch<{
        alreadyConsumed: boolean;
        record: MealConsumptionRecord;
      }>('/api/meal-plan/consumption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mealPlanId, dayIndex, mealType }),
      });
      if (!result.ok) throw new Error(result.error ?? 'No se pudo registrar la comida cocinada.');
      if (!componentActiveRef.current || activePlanIdRef.current !== mealPlanId) return;

      setConsumptions((current) => withConsumptionRecord(current, key, result.data.record));
      if (result.data.alreadyConsumed) {
        setConsumptionMessage('Esta comida ya estaba registrada como cocinada.');
      } else {
        const updated = result.data.record.decrements.length;
        const skipped = result.data.record.skipped.length;
        const parts = ['Comida registrada.'];
        if (updated > 0)
          parts.push(
            `Se actualizaron ${updated} ${updated === 1 ? 'existencia' : 'existencias'} del inventario.`
          );
        if (skipped > 0)
          parts.push(
            `${skipped} ${skipped === 1 ? 'ingrediente quedó' : 'ingredientes quedaron'} sin descuento automático.`
          );
        setConsumptionMessage(parts.join(' '));
      }
      void loadSuggestions(mealPlanId);
    } catch (error) {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId) {
        setConsumptionError(
          error instanceof Error ? error.message : 'No se pudo registrar la comida cocinada.'
        );
      }
    } finally {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId) {
        setConsumingMealKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Planificador de menú</h1>
            <p className="text-bistro-text-secondary">
              Generá un menú para el período elegido con IA.
            </p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-bistro-action-primary">
            Volver
          </Link>
        </div>

        {isInitialLoading ? (
          <p className="mb-3 text-sm text-bistro-text-secondary">Cargando menú guardado...</p>
        ) : null}
        {loadError ? <LoadErrorNotice message={loadError} /> : null}

        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Comensales
            <input
              type="number"
              min={1}
              value={peopleCount}
              onChange={(event) => {
                userEditedRef.current = true;
                setPeopleCount(Number(event.target.value));
              }}
              className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Período
            <select
              value={period}
              onChange={(event) => {
                userEditedRef.current = true;
                setPeriod(event.target.value as 'week' | 'fortnight' | 'month');
              }}
              className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
            >
              <option value="week">Semana</option>
              <option value="fortnight">Quincena</option>
              <option value="month">Mes</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Cocina base
            <input
              value={baseCuisine}
              onChange={(event) => {
                userEditedRef.current = true;
                setBaseCuisine(event.target.value);
              }}
              placeholder="Latinoamericana"
              className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
            Restricciones (separadas por comas)
            <input
              value={restrictions}
              onChange={(event) => {
                userEditedRef.current = true;
                setRestrictions(event.target.value);
              }}
              className="h-11 rounded-xl border border-bistro-border bg-white px-3 outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={isGenerating}
            className="h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
          >
            {isGenerating ? 'Generando...' : 'Generar menú'}
          </button>
        </form>

        {generationError ? (
          <p className="mt-4 rounded-xl border border-bistro-danger/30 bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
            {generationError}
          </p>
        ) : null}

        {plan ? (
          <div className="mt-6 rounded-xl border border-bistro-border bg-bistro-page p-4">
            <h2 className="font-semibold">Menú generado</h2>
            {activePlanId ? (
              <ScheduleConfirmation
                key={`${activePlanId}:${JSON.stringify(plan.days)}`}
                plan={plan}
                mealPlanId={activePlanId}
                peopleCount={planPeopleCount}
                disabled={isGenerating || isConfirmingAdaptive}
                onConfirmed={(mealPlanId, confirmedPlan, schedule) => {
                  if (!componentActiveRef.current || activePlanIdRef.current !== mealPlanId || planRef.current !== confirmedPlan) return;
                  setCurrentPlan({ ...confirmedPlan, schedule });
                  void loadSuggestions(mealPlanId);
                }}
              />
            ) : null}

            <p className="mt-1 text-sm text-bistro-text-secondary">
              Los tiempos son estimaciones de IA, no una garantía de duración real.
            </p>
            {isLoadingConsumptions ? (
              <p className="mt-2 text-sm text-bistro-text-secondary">
                Cargando comidas cocinadas...
              </p>
            ) : null}
            {consumptionError ? (
              <p role="alert" className="mt-2 text-sm text-bistro-danger">
                {consumptionError}
              </p>
            ) : null}
            {consumptionMessage ? (
              <p role="status" className="mt-2 text-sm font-semibold text-bistro-success">
                {consumptionMessage}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-bistro-text-secondary">
              Revisa los ingredientes y etiquetas del menú antes de cocinar. El plan no certifica ausencia de alérgenos.
            </p>
            <section className="mt-4 rounded-xl border border-bistro-border bg-white p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold">Adaptar menú con evidencia</h3>
                  <p className="text-sm text-bistro-text-secondary">
                    Prepara una propuesta con inventario y preferencias reales. No guarda ni
                    descuenta stock hasta que confirmes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onRequestAdaptiveProposal()}
                  disabled={isLoadingAdaptive || isConfirmingAdaptive}
                  className="h-10 rounded-lg border border-bistro-action-primary px-3 text-sm font-semibold text-bistro-action-primary disabled:opacity-60"
                >
                  {isLoadingAdaptive ? 'Analizando...' : 'Preparar propuesta'}
                </button>
              </div>
              {adaptiveError ? (
                <p role="alert" className="mt-2 text-sm text-bistro-danger">
                  {adaptiveError}
                </p>
              ) : null}
              {adaptiveMessage ? (
                <p role="status" className="mt-2 text-sm font-semibold text-bistro-success">
                  {adaptiveMessage}
                </p>
              ) : null}
              {adaptiveProposal ? (
                <div className="mt-3 grid gap-3" data-testid="adaptive-proposal">
                  <p className="text-sm text-bistro-text-secondary">
                    Confianza declarada: <strong>{adaptiveProposal.confidence}</strong>. Los cambios
                    son temporales hasta confirmarlos.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {adaptiveProposal.evidence.map((item) => (
                      <p
                        key={item.label}
                        className="rounded-lg bg-bistro-page p-2 text-xs text-bistro-text-secondary"
                      >
                        <strong>{item.label}:</strong>{' '}
                        {item.status === 'known' ? 'conocido' : 'desconocido'} — {item.detail}
                      </p>
                    ))}
                  </div>
                  {adaptiveProposal.changes.length === 0 ? (
                    <p className="rounded-lg bg-bistro-surface-warm p-2 text-sm text-bistro-success">
                      No hay una mejora justificable con la evidencia disponible. El menú no cambia.
                    </p>
                  ) : (
                    <ul className="grid gap-2 text-sm">
                      {adaptiveProposal.changes.map((change) => (
                        <li
                          key={`${change.slotKey}-${change.previousMeal}-${change.proposedMeal}`}
                          className="rounded-lg border border-bistro-border p-2"
                        >
                          <strong>{change.slotKey}:</strong> {change.previousMeal} →{' '}
                          {change.proposedMeal}
                          <span className="block text-xs text-bistro-text-secondary">
                            {change.reason}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-bistro-text-secondary">
                    {adaptiveProposal.limitations.join(' ')}
                  </p>
                  {adaptiveProposal.changes.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => void onConfirmAdaptiveProposal()}
                      disabled={
                        isConfirmingAdaptive ||
                        isLoadingAdaptive ||
                        isLoadingConsumptions ||
                        consumingMealKeys.size > 0
                      }
                      className="h-10 rounded-lg bg-bistro-action-primary px-3 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {isConfirmingAdaptive ? 'Guardando...' : 'Confirmar y guardar propuesta'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
            <div className="mt-3 grid gap-3">
              {plan.days.map((day) => (
                <section
                  key={day.dayIndex}
                  className="rounded-xl border border-bistro-border bg-white p-3"
                >
                  <h3 className="font-semibold">{day.label}</h3>
                  <div className="mt-2 grid gap-2 text-sm">
                    {day.meals.map((meal) => {
                      const consumptionKey = mealConsumptionKey(day.dayIndex, meal.mealType);
                      const consumed = consumptions[consumptionKey];
                      const isConsuming = consumingMealKeys.has(consumptionKey);
                      return (
                        <article
                          key={meal.mealType}
                          className="rounded-lg border border-bistro-border p-3"
                        >
                          <p className="font-semibold text-bistro-text-secondary">
                            {mealTypeLabels[meal.mealType]}: {meal.title}
                          </p>
                          {meal.prepMinutes === null || meal.prepMinutes === undefined ? (
                            <p className="text-bistro-text-secondary">tiempo no estimado</p>
                          ) : (
                            <p className="text-bistro-text-secondary">
                              {meal.prepMinutes} min estimados
                            </p>
                          )}
                          {meal.description ? (
                            <p className="text-bistro-text-secondary">{meal.description}</p>
                          ) : null}
                          {meal.recipeRef && <p className="mt-1 text-xs text-bistro-text-secondary">Receta vinculada: los datos de abajo corresponden a la estimación original del menú.</p>}
                          {meal.ingredients.length > 0 ? (
                            <ul className="mt-1 list-disc pl-5 text-bistro-text-secondary">
                              {meal.ingredients.map((ingredient, index) => (
                                <li key={`${ingredient.name}-${index}`}>
                                  {ingredient.quantity === null
                                    ? ingredient.name
                                    : `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''} ${ingredient.name}`}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <MealPreparationAction
                            key={`${activePlanId ?? 'unsaved'}:${day.dayIndex}:${meal.mealType}:${JSON.stringify(meal)}`}
                            meal={meal}
                            peopleCount={planPeopleCount}
                            hardRestrictions={planHardRestrictions}
                          />
                          {activePlanId ? (
                            <div className="mt-3">
                              {consumed ? (
                                <span className="inline-flex rounded-full bg-bistro-success/10 px-3 py-1 text-xs font-semibold text-bistro-success">
                                  Cocinado
                                </span>
                              ) : meal.recipeRef ? (
                                <Link href={'/app/cooking-intent?source=meal_slot&mealPlanId=' + encodeURIComponent(activePlanId) + '&dayIndex=' + day.dayIndex + '&mealType=' + meal.mealType} className="text-sm font-semibold text-bistro-action-primary underline">
                                  Ver receta vinculada y registrar consumo real
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void onConfirmMealConsumed(day.dayIndex, meal.mealType)
                                  }
                                  disabled={
                                    isLoadingConsumptions ||
                                    isGenerating ||
                                    isConsuming ||
                                    isConfirmingAdaptive
                                  }
                                  aria-label={`Ya cociné ${mealTypeLabels[meal.mealType]}: ${meal.title}`}
                                  className="h-9 rounded-lg border border-bistro-action-primary px-3 text-sm font-semibold text-bistro-action-primary disabled:opacity-60"
                                >
                                  {isConsuming ? 'Registrando...' : 'Ya cociné'}
                                </button>
                              )}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ) : null}

        {activePlanId ? (
          <section
            className="mt-6 rounded-xl border border-bistro-border bg-white p-4"
            aria-busy={isLoadingSuggestions || isConfirming}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-semibold">Compras anticipadas</h2>
                <p className="mt-1 text-sm text-bistro-text-secondary">
                  Calculadas sólo con agenda, porciones, inventario y comidas confirmadas.
                </p>
              </div>
              <label className="grid gap-1 text-sm font-semibold text-bistro-text-secondary">
                Horizonte
                <select
                  value={shoppingHorizon}
                  onChange={(event) => {
                    const nextHorizon = event.target.value === '14' ? 14 : 7;
                    shoppingHorizonRef.current = nextHorizon;
                    setShoppingHorizon(nextHorizon);
                    setSuggestions([]);
                    setSelectedItems(new Set());
                    setShoppingMessage(null);
                    setShoppingError(null);
                    if (activePlanIdRef.current) {
                      void loadSuggestions(activePlanIdRef.current, false, nextHorizon);
                    }
                  }}
                  disabled={isLoadingSuggestions || isConfirming || isGenerating}
                  className="h-10 rounded-lg border border-bistro-border bg-white px-2 font-normal"
                >
                  <option value="7">7 días</option>
                  <option value="14">14 días</option>
                </select>
              </label>
            </div>
            {isLoadingSuggestions ? (
              <p className="mt-2 text-sm text-bistro-text-secondary">Calculando compras...</p>
            ) : null}
            {shoppingError ? (
              <p role="alert" className="mt-2 text-sm text-bistro-danger">
                {shoppingError}
              </p>
            ) : null}
            {!isLoadingSuggestions && !shoppingError && shoppingStatus === 'unknown' ? (
              <p
                aria-live="polite"
                className="mt-2 rounded-lg bg-bistro-warning/10 p-3 text-sm text-bistro-warning"
              >
                No se puede calcular este horizonte con seguridad
                {shoppingReason ? ` (${shoppingReason}).` : '.'} Confirmá la agenda y las porciones
                y asegurate de que el plan cubra el horizonte solicitado.
              </p>
            ) : null}
            {!isLoadingSuggestions && !shoppingError && shoppingStatus === 'ready' && suggestions.length === 0 ? (
              <p className="mt-2 text-sm text-bistro-text-secondary">
                No hay faltantes accionables para este menú.
              </p>
            ) : null}
            {suggestions.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {suggestions.map((item) => {
                  const existingLabel = item.alreadyPresent
                    ? item.shoppingStatus === 'purchased'
                      ? 'Ya comprado'
                      : 'Ya está en compras'
                    : null;
                  const quantity = (value: number | null) =>
                    value === null
                      ? 'Sin cantidad especificada'
                      : `${value}${item.unit !== 'unknown' ? ` ${item.unit}` : ''}`;
                  return (
                    <li
                      key={item.normalizedName}
                      className="rounded-xl border border-bistro-border p-3"
                    >
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.normalizedName)}
                          disabled={
                            isLoadingSuggestions ||
                            isConfirming ||
                            isGenerating ||
                            Boolean(existingLabel) ||
                            item.status !== 'buy'
                          }
                          onChange={(event) =>
                            setSelectedItems((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.normalizedName);
                              else next.delete(item.normalizedName);
                              return next;
                            })
                          }
                          aria-label={`${item.ingredientName}, ${item.status === 'buy' ? 'Comprar' : 'Revisar'}`}
                        />
                        <span className="grid gap-1 text-sm">
                          <span className="font-semibold">{item.ingredientName}</span>
                          <span>
                            Requerido: {quantity(item.requiredQuantity)} · Disponible:{' '}
                            {quantity(item.availableQuantity)}
                          </span>
                          <span>Para comprar: {quantity(item.quantityToBuy)}</span>
                          {item.estimatedCost !== null ? (
                            <span>
                              Costo estimado del artículo: {item.estimatedCost.toFixed(2)}
                            </span>
                          ) : (
                            <span>Costo: desconocido</span>
                          )}
                          <span className="font-semibold">
                            {existingLabel ??
                              (item.status === 'buy'
                                ? item.transferCompleted
                                  ? 'Ya transferido; verificar inventario'
                                  : 'Comprar'
                                : 'Revisar: cantidad o unidad desconocida')}
                          </span>
                          {item.existingShoppingSources.length > 0 ? (
                            <span className="text-bistro-text-secondary">
                              Ya existe en: {item.existingShoppingSources.join(', ')}.
                            </span>
                          ) : null}
                          <span className="text-bistro-text-secondary">
                            Usado en: {item.usedInRecipes.join('; ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {shoppingMessage ? (
              <p role="status" className="mt-3 text-sm font-semibold text-bistro-success">
                {shoppingMessage}
              </p>
            ) : null}
            {shoppingCost && shoppingCost.itemCount > 0 ? (
              <p className="mt-3 text-sm text-bistro-text-secondary">
                {shoppingCost.status === 'complete'
                  ? `Costo estimado total verificable: ${shoppingCost.estimatedTotal?.toFixed(2) ?? '0.00'}.`
                  : shoppingCost.status === 'partial'
                    ? `Costo estimado parcial: ${shoppingCost.estimatedTotal?.toFixed(2) ?? 'desconocido'}; faltan precios o cantidades para completar el total.`
                    : 'Costo total desconocido: faltan precios o cantidades verificables.'}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void onConfirmSelected()}
              disabled={
                isLoadingSuggestions ||
                isConfirming ||
                isGenerating ||
                shoppingStatus !== 'ready' ||
                !shoppingExpectedUpdatedAt ||
                !shoppingFingerprint ||
                selectedItems.size === 0
              }
              className="mt-4 h-11 rounded-xl bg-bistro-action-primary px-4 font-semibold text-white disabled:opacity-60"
            >
              {isConfirming ? 'Agregando...' : 'Agregar seleccionados a compras'}
            </button>
          </section>
        ) : null}
      </section>
    </main>
  );
}
