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
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';

type ShoppingSuggestion = {
  normalizedName: string;
  ingredientName: string;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  quantityToBuy: number | null;
  unit: string;
  status: 'buy' | 'review';
  usedInRecipes: string[];
  alreadyPresent: boolean;
  shoppingStatus: 'pending' | 'purchased' | null;
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
  const [period, setPeriod] = useState<'week' | 'fortnight' | 'month'>('week');
  const [baseCuisine, setBaseCuisine] = useState('');
  const [restrictions, setRestrictions] = useState('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StructuredMealPlan | null>(null);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ShoppingSuggestion[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [shoppingMessage, setShoppingMessage] = useState<string | null>(null);
  const [shoppingError, setShoppingError] = useState<string | null>(null);
  const generationStartedRef = useRef(false);
  const activePlanIdRef = useRef<string | null>(null);
  const suggestionRequestVersionRef = useRef(0);
  const componentActiveRef = useRef(true);
  const userEditedRef = useRef(false);

  const loadSuggestions = useCallback(async (mealPlanId: string) => {
    const requestVersion = ++suggestionRequestVersionRef.current;
    setIsLoadingSuggestions(true);
    setShoppingError(null);
    setShoppingMessage(null);
    try {
      const result = await safeFetch<{ items: ShoppingSuggestion[] }>(
        `/api/meal-plan/shopping-suggestions?mealPlanId=${encodeURIComponent(mealPlanId)}`,
        { credentials: 'same-origin' }
      );
      if (!result.ok) throw new Error(result.error ?? 'No se pudieron cargar los faltantes.');
      if (!shouldApplyMealPlannerSuggestions({
        componentActive: componentActiveRef.current,
        requestVersion,
        latestRequestVersion: suggestionRequestVersionRef.current,
        activePlanId: activePlanIdRef.current,
        mealPlanId,
      })) return;
      setSuggestions(result.data.items);
      setSelectedItems(new Set(
        result.data.items
          .filter((item) => item.status === 'buy' && !item.alreadyPresent)
          .map((item) => item.normalizedName)
      ));
    } catch (error) {
      if (
        componentActiveRef.current &&
        suggestionRequestVersionRef.current === requestVersion &&
        activePlanIdRef.current === mealPlanId
      ) {
        setShoppingError(error instanceof Error ? error.message : 'No se pudieron cargar los faltantes.');
      }
    } finally {
      if (componentActiveRef.current && suggestionRequestVersionRef.current === requestVersion) {
        setIsLoadingSuggestions(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    componentActiveRef.current = true;

    const loadLatestMealPlan = async () => {
      try {
        const result = await safeFetch<MealPlanPublicResponse>('/api/meal-plan', {
          credentials: 'same-origin',
        });
        if (!result.ok) {
          throw new Error(result.error ?? 'No se pudo cargar el menú guardado.');
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
        const restoredPlanId = restored.plan && typeof result.data.id === 'string' ? result.data.id : null;
        activePlanIdRef.current = restoredPlanId;
        setActivePlanId(restoredPlanId);
        setPeopleCount(restored.peopleCount);
        setPeriod(restored.period);
        setBaseCuisine(restored.baseCuisine);
        setRestrictions(restored.restrictions);
        setPlan(restored.plan);
        if (restoredPlanId) void loadSuggestions(restoredPlanId);
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
    };
  }, [loadSuggestions]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    generationStartedRef.current = true;
    suggestionRequestVersionRef.current += 1;
    activePlanIdRef.current = null;
    setActivePlanId(null);
    setSuggestions([]);
    setSelectedItems(new Set());
    setShoppingMessage(null);
    setShoppingError(null);
    setIsConfirming(false);
    setIsGenerating(true);
    setGenerationError(null);
    setPlan(null);

    try {
      const result = await safeFetch<{ id?: string; plan?: StructuredMealPlan; content?: string }>('/api/meal-plan', {
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
      const generatedPlanId = typeof result.data.id === 'string' ? result.data.id : null;
      activePlanIdRef.current = generatedPlanId;
      setActivePlanId(generatedPlanId);
      if (generatedPlanId) void loadSuggestions(generatedPlanId);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : 'Error desconocido.');
    } finally {
      setIsGenerating(false);
    }
  };

  const onConfirmSelected = async () => {
    if (!activePlanId || selectedItems.size === 0 || isConfirming) return;
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
        body: JSON.stringify({ mealPlanId, selectedItems: [...selectedItems] }),
      });
      if (!result.ok) throw new Error(result.error ?? 'No se pudieron agregar los artículos.');
      if (
        !componentActiveRef.current ||
        generationStartedRef.current ||
        activePlanIdRef.current !== mealPlanId ||
        suggestionRequestVersionRef.current !== requestVersion
      ) return;

      const confirmed = new Map<string, 'pending' | 'purchased'>();
      for (const item of [...result.data.added, ...result.data.alreadyPresent]) {
        confirmed.set(normalizeInventoryName(item.ingredient_name), item.status);
      }
      setSuggestions((current) => current.map((item) => {
        const status = confirmed.get(item.normalizedName);
        return status ? { ...item, alreadyPresent: true, shoppingStatus: status } : item;
      }));
      setSelectedItems((current) => new Set(
        [...current].filter((name) => !confirmed.has(name))
      ));
      const parts: string[] = [];
      if (result.data.added.length) {
        parts.push(`Se agregaron ${result.data.added.length} ${result.data.added.length === 1 ? 'artículo' : 'artículos'}.`);
      }
      if (result.data.alreadyPresent.length) {
        parts.push(`${result.data.alreadyPresent.length} ${result.data.alreadyPresent.length === 1 ? 'ya estaba' : 'ya estaban'} en compras.`);
      }
      if (result.data.ignored.length) {
        parts.push(`Se ignoraron claves desactualizadas: ${result.data.ignored.join(', ')}.`);
      }
      setShoppingMessage(parts.join(' ') || 'No hubo artículos nuevos para agregar.');
    } catch (error) {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId) {
        setShoppingError(error instanceof Error ? error.message : 'No se pudieron agregar los artículos.');
      }
    } finally {
      if (componentActiveRef.current && activePlanIdRef.current === mealPlanId) setIsConfirming(false);
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
              onChange={(event) => {
                userEditedRef.current = true;
                setPeopleCount(Number(event.target.value));
              }}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Período
            <select
              value={period}
              onChange={(event) => {
                userEditedRef.current = true;
                setPeriod(event.target.value as 'week' | 'fortnight' | 'month');
              }}
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
              onChange={(event) => {
                userEditedRef.current = true;
                setBaseCuisine(event.target.value);
              }}
              placeholder="Latinoamericana"
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Restricciones (separadas por comas)
            <input
              value={restrictions}
              onChange={(event) => {
                userEditedRef.current = true;
                setRestrictions(event.target.value);
              }}
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

        {activePlanId ? (
          <section className="mt-6 rounded-xl border border-[#E8DDD2] bg-white p-4" aria-busy={isLoadingSuggestions || isConfirming}>
            <h2 className="font-semibold">Faltantes para este menú</h2>
            {isLoadingSuggestions ? <p className="mt-2 text-sm text-[#6B5A50]">Cargando faltantes...</p> : null}
            {shoppingError ? <p role="alert" className="mt-2 text-sm text-red-700">{shoppingError}</p> : null}
            {!isLoadingSuggestions && suggestions.length === 0 ? (
              <p className="mt-2 text-sm text-[#6B5A50]">No hay faltantes accionables para este menú.</p>
            ) : null}
            {suggestions.length > 0 ? (
              <ul className="mt-3 grid gap-3">
                {suggestions.map((item) => {
                  const existingLabel = item.alreadyPresent
                    ? item.shoppingStatus === 'purchased' ? 'Ya comprado' : 'Ya está en compras'
                    : null;
                  const quantity = (value: number | null) =>
                    value === null ? 'Sin cantidad especificada' : `${value}${item.unit !== 'unknown' ? ` ${item.unit}` : ''}`;
                  return (
                    <li key={item.normalizedName} className="rounded-xl border border-[#E8DDD2] p-3">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.normalizedName)}
                          disabled={isLoadingSuggestions || isConfirming || isGenerating || Boolean(existingLabel)}
                          onChange={(event) => setSelectedItems((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(item.normalizedName);
                            else next.delete(item.normalizedName);
                            return next;
                          })}
                          aria-label={`${item.ingredientName}, ${item.status === 'buy' ? 'Comprar' : 'Revisar'}`}
                        />
                        <span className="grid gap-1 text-sm">
                          <span className="font-semibold">{item.ingredientName}</span>
                          <span>Requerido: {quantity(item.requiredQuantity)} · Disponible: {quantity(item.availableQuantity)}</span>
                          <span>Para comprar: {quantity(item.quantityToBuy)}</span>
                          <span className="font-semibold">
                            {existingLabel ?? (item.status === 'buy' ? 'Comprar' : 'Revisar')}
                          </span>
                          <span className="text-[#6B5A50]">Usado en: {item.usedInRecipes.join('; ')}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {shoppingMessage ? <p role="status" className="mt-3 text-sm font-semibold text-green-800">{shoppingMessage}</p> : null}
            <button
              type="button"
              onClick={() => void onConfirmSelected()}
              disabled={isLoadingSuggestions || isConfirming || isGenerating || selectedItems.size === 0}
              className="mt-4 h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
            >
              {isConfirming ? 'Agregando...' : 'Agregar seleccionados a compras'}
            </button>
          </section>
        ) : null}
      </section>
    </main>
  );
}
