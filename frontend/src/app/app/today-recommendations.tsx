'use client';

import { useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';
import { scaleRecipeIngredients } from '@/lib/inventory/portion-scaling';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { assessSessionInventoryQuantity } from '@/lib/today/session-inventory-confirmation';

export type TodaySlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type TodayOptionSource = 'provider' | 'history' | 'saved_plan' | 'saved_recipe';

export interface TodayIngredientAvailability {
  name: string;
  availability: 'sufficient' | 'partial' | 'missing' | 'unknown';
  quantityProvenance?: 'ai_estimate' | 'unknown';
  present: boolean;
  requiredQuantity: number | null;
  requiredUnit: string;
  availableQuantity: number | null;
  availableUnit: string;
  missingQuantity: number | null;
  remainingQuantity: number | null;
}

export interface TodayOption {
  title: string;
  slot: TodaySlot;
  ingredients: string[];
  prepMinutes: number | null;
  source: TodayOptionSource;
  reason: string;
  availableIngredients: string[];
  missingIngredients: string[];
  unknownIngredients?: string[];
  ingredientAvailability?: TodayIngredientAvailability[];
  servings?: number | null;
  quantityProvenance?: 'ai_estimate' | 'unknown';
}

export interface TodayResponse {
  status: 'success' | 'degraded';
  options: TodayOption[];
  reason?: 'provider-unavailable' | 'insufficient-safe-options';
  warnings?: string[];
}

export interface TodayOptionIntent {
  slot: TodaySlot;
  title: string;
  ingredients: string[];
  targetServings: number;
}

interface TodayRecommendationResultsProps {
  response: TodayResponse;
  slot: TodaySlot;
  onChoose: (option: TodayOptionIntent) => void;
}

interface SessionInventoryInput {
  quantity: string;
  confirmed: boolean;
  response: TodayResponse;
  decisionKey: string;
}

function scaleInventoryRequirement(requiredQuantity: number | null, factor: number | null): number | null {
  if (
    requiredQuantity === null || !Number.isFinite(requiredQuantity) || requiredQuantity <= 0 ||
    factor === null || !Number.isFinite(factor) || factor <= 0
  ) return null;
  const scaled = requiredQuantity * factor;
  return Number.isFinite(scaled) && scaled > 0 ? scaled : null;
}

function inventoryDecisionKey(
  ingredient: TodayIngredientAvailability,
  targetServings: number | null,
  factor: number | null,
): string {
  return [
    targetServings ?? 'unknown',
    factor ?? 'unknown',
    normalizeInventoryName(ingredient.name),
    ingredient.requiredQuantity ?? 'unknown',
    ingredient.requiredUnit,
    ingredient.quantityProvenance ?? 'known',
  ].join(':');
}

const slots: Array<{ value: TodaySlot; label: string }> = [
  { value: 'breakfast', label: 'Desayuno' },
  { value: 'lunch', label: 'Almuerzo' },
  { value: 'snack', label: 'Merienda' },
  { value: 'dinner', label: 'Cena' },
];

export function getNextSlotIndex(currentIndex: number, key: string, slotCount: number): number | null {
  if (slotCount <= 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % slotCount;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + slotCount) % slotCount;
  return null;
}

function formatAmount(quantity: number | null, unit: string): string | null {
  return quantity === null || unit === 'unknown' ? null : `${quantity} ${unit}`;
}

function parsePositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTargetServings(value: string): number | null {
  const parsed = parsePositiveNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed <= 100 ? parsed : null;
}

function parseNonNegativeNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatIngredientAvailability(
  ingredient: TodayIngredientAvailability,
  requiredQuantity: number | null,
  requirementIsScaled: boolean,
): string {
  const required = formatAmount(requiredQuantity, ingredient.requiredUnit);
  const sourceRequirement = formatAmount(ingredient.requiredQuantity, ingredient.requiredUnit);
  const registered = formatAmount(ingredient.availableQuantity, ingredient.availableUnit);
  const quantitySource = ingredient.quantityProvenance === undefined
    ? []
    : [ingredient.quantityProvenance === 'ai_estimate'
      ? 'cantidad estimada por IA; no se puede verificar suficiencia'
      : 'procedencia de cantidad desconocida'];
  const requirement = required
    ? `${requirementIsScaled ? 'requiere' : 'requerimiento de origen'} ${required}`
    : sourceRequirement && !requirementIsScaled
      ? `requerimiento de origen ${sourceRequirement}`
      : 'requerimiento no cuantificable';
  return [
    `${ingredient.name}: ${requirement}`,
    ...quantitySource,
    registered ? `registrado ${registered} (sin confirmar)` : ingredient.present ? 'cantidad registrada no comparable' : 'sin cantidad registrada; no se asume cero',
  ].join('; ');
}

const sourceLabels: Record<TodayOptionSource, string> = {
  provider: 'sugerencia nueva',
  history: 'historial reciente',
  saved_plan: 'plan guardado',
  saved_recipe: 'receta guardada',
};

export function TodayRecommendationResults({ response, slot, onChoose }: TodayRecommendationResultsProps) {
  const [portionInputs, setPortionInputs] = useState<Record<string, { original: string; target: string }>>({});
  const [inventoryInputs, setInventoryInputs] = useState<Record<string, SessionInventoryInput>>({});
  const slotLabel = slots.find((item) => item.value === slot)?.label ?? 'Momento elegido';
  const options = response.options.filter((option) => option.slot === slot);
  return (
    <div className="mt-5" aria-live="polite">
      {response.status === 'degraded' ? (
        <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {options.length > 0
            ? 'No pudimos obtener suficientes sugerencias; mostramos las opciones disponibles.'
            : 'No encontramos opciones para este momento.'}
        </p>
      ) : null}
      {options.length === 0 ? (
        response.status === 'success' ? <p role="status">No encontramos opciones para este momento.</p> : null
      ) : (
        <>
          <h3 className="mb-3 text-lg font-semibold text-[#241A14]">Opciones para {slotLabel}</h3>
          <ul role="list" className="grid gap-4 md:grid-cols-2">
            {options.map((option, index) => {
              const portionKey = `${option.slot}:${option.source}:${option.title}:${index}`;
              const input = portionInputs[portionKey] ?? { original: '', target: '' };
              const declaredBaseServings = typeof option.servings === 'number'
                && Number.isFinite(option.servings) && option.servings > 0
                ? option.servings
                : null;
              const baseServings = declaredBaseServings ?? parsePositiveNumber(input.original);
              const targetServings = parseTargetServings(input.target);
              const scaling = scaleRecipeIngredients(option.ingredients, baseServings, targetServings);
              const ingredientAvailability = option.ingredientAvailability ?? [];
              const requirementNameCounts = new Map<string, number>();
              for (const ingredient of ingredientAvailability) {
                const normalizedName = normalizeInventoryName(ingredient.name);
                requirementNameCounts.set(normalizedName, (requirementNameCounts.get(normalizedName) ?? 0) + 1);
              }
              const duplicateRequirementNames = new Set(
                [...requirementNameCounts].filter(([, count]) => count > 1).map(([name]) => name)
              );
              const getConfirmation = (ingredient: TodayIngredientAvailability, ingredientIndex: number) => {
                const stored = inventoryInputs[`${portionKey}:${ingredientIndex}`];
                const decisionKey = inventoryDecisionKey(ingredient, targetServings, scaling.factor);
                return stored?.response === response && stored.decisionKey === decisionKey
                  ? stored
                  : { quantity: '', confirmed: false };
              };
              const sessionStatuses = ingredientAvailability.map((ingredient, ingredientIndex) => {
                const confirmation = getConfirmation(ingredient, ingredientIndex);
                const confirmedQuantity = parseNonNegativeNumber(confirmation.quantity);
                if (ingredient.requiredUnit === 'unknown' || ingredient.quantityProvenance !== undefined || duplicateRequirementNames.has(normalizeInventoryName(ingredient.name))) return 'unknown' as const;
                return assessSessionInventoryQuantity(
                  scaleInventoryRequirement(ingredient.requiredQuantity, scaling.factor),
                  confirmedQuantity,
                  confirmation.confirmed
                );
              });
              const decisionAvailability = sessionStatuses.length === 0 || sessionStatuses.includes('unknown')
                ? 'unknown'
                : sessionStatuses.every((status) => status === 'sufficient')
                  ? 'sufficient'
                  : sessionStatuses.every((status) => status === 'missing')
                    ? 'missing'
                    : 'partial';
              const registeredIngredients = ingredientAvailability.filter((ingredient) => ingredient.present).map((ingredient) => ingredient.name);
              const reportedInventoryIngredients = [...new Set([
                ...option.availableIngredients,
                ...option.missingIngredients,
                ...(option.unknownIngredients ?? []),
              ])];
              const canChoose = baseServings !== null && targetServings !== null;
              const updatePortionInput = (field: 'original' | 'target', value: string) => {
                setPortionInputs((previous) => ({
                  ...previous,
                  [portionKey]: { ...(previous[portionKey] ?? { original: '', target: '' }), [field]: value },
                }));
              };

              return (
              <li key={`${option.title}-${index}`} role="listitem" className="rounded-2xl border border-[#E8DDD2] bg-white p-5 shadow-sm">
                <article aria-labelledby={`today-option-${index}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 id={`today-option-${index}`} className="text-lg font-semibold text-[#241A14]">{option.title}</h4>
                    <span className="rounded-full bg-[#F8F4EF] px-3 py-1 text-xs font-semibold text-[#6B5A50]">{slotLabel}</span>
                  </div>
                  <p className="mt-2 text-sm text-[#6B5A50]">{option.reason}</p>
                  <p className="mt-1 text-xs text-[#6B5A50]">Origen: {sourceLabels[option.source]}</p>
                  {option.quantityProvenance === 'ai_estimate' ? (
                    <p className="mt-1 text-xs text-amber-800">Cantidades estimadas por IA; no verificadas.</p>
                  ) : option.quantityProvenance === 'unknown' ? (
                    <p className="mt-1 text-xs text-[#6B5A50]">Procedencia de cantidades desconocida.</p>
                  ) : null}
                  <p className="mt-2 text-sm text-[#6B5A50]">
                    {option.prepMinutes === null ? 'Tiempo no estimado' : `${option.prepMinutes} minutos`}
                  </p>
                  <p className="mt-3 text-xs text-[#6B5A50]">Las cantidades registradas no se consideran verificadas hasta que confirmes lo que tenés ahora para esta decisión. Esta confirmación no se guarda.</p>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div><dt className="inline font-semibold text-[#241A14]">{ingredientAvailability.length ? 'Inventario registrado, aún sin confirmar: ' : 'Datos de inventario reportados (sin confirmar): '}</dt><dd className="inline text-[#6B5A50]">{ingredientAvailability.length ? (registeredIngredients.length ? registeredIngredients.join(', ') : 'sin cantidades registradas') : (reportedInventoryIngredients.length ? reportedInventoryIngredients.join(', ') : 'sin detalle disponible')}</dd></div>
                    <div><dt className="inline font-semibold text-[#241A14]">Disponibilidad para esta decisión: </dt><dd className="inline text-[#6B5A50]">{decisionAvailability === 'unknown' ? 'desconocida' : decisionAvailability === 'sufficient' ? 'suficiente' : decisionAvailability === 'missing' ? 'faltante según cantidades confirmadas' : 'parcial según cantidades confirmadas'}</dd></div>
                    {ingredientAvailability.length ? (
                      <div>
                        <dt className="font-semibold text-[#241A14]">Detalle de cantidades registradas</dt>
                        <dd className="text-[#6B5A50]">
                          {scaling.factor !== null && targetServings !== null
                            ? `Requerimientos ajustados para ${targetServings} porciones.`
                            : 'Requerimientos de origen; disponibilidad desconocida hasta definir porciones.'}
                          <ul className="mt-1 grid gap-3">
                            {ingredientAvailability.map((ingredient, ingredientIndex) => {
                              const confirmationKey = `${portionKey}:${ingredientIndex}`;
                              const decisionKey = inventoryDecisionKey(ingredient, targetServings, scaling.factor);
                              const confirmation = getConfirmation(ingredient, ingredientIndex);
                              const scaledRequiredQuantity = scaleInventoryRequirement(ingredient.requiredQuantity, scaling.factor);
                              const duplicateRequirement = duplicateRequirementNames.has(normalizeInventoryName(ingredient.name));
                              const isComparable = ingredient.requiredQuantity !== null && ingredient.requiredUnit !== 'unknown' && ingredient.quantityProvenance === undefined && !duplicateRequirement;
                              const canConfirm = isComparable && parseNonNegativeNumber(confirmation.quantity) !== null;
                              return (
                                <li key={`${ingredient.name}-${ingredientIndex}`}>
                                  <p>{formatIngredientAvailability(ingredient, scaledRequiredQuantity, scaling.factor !== null)}</p>
                                  {ingredient.quantityProvenance === 'ai_estimate' ? (
                                    <p className="mt-1 text-amber-800">Cantidad estimada por IA; no se puede verificar suficiencia.</p>
                                  ) : ingredient.quantityProvenance === 'unknown' ? (
                                    <p className="mt-1">Procedencia de cantidad desconocida; no se puede verificar suficiencia.</p>
                                  ) : duplicateRequirement ? (
                                    <p className="mt-1">Ingrediente repetido; confirmación individual no disponible.</p>
                                  ) : isComparable ? (
                                    <div className="mt-1 grid gap-1">
                                      <label htmlFor={`today-inventory-quantity-${index}-${ingredientIndex}`} className="font-medium">Cantidad actual de {ingredient.name} ({ingredient.requiredUnit})</label>
                                      <input
                                        id={`today-inventory-quantity-${index}-${ingredientIndex}`}
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={confirmation.quantity}
                                        aria-label={`Cantidad actual de ${ingredient.name} (${ingredient.requiredUnit})`}
                                        onChange={(event) => setInventoryInputs((previous) => ({
                                          ...previous,
                                          [confirmationKey]: { quantity: event.target.value, confirmed: false, response, decisionKey },
                                        }))}
                                        className="rounded-lg border border-[#C8B9AC] px-3 py-2 text-sm"
                                      />
                                      <label className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          aria-label={`Confirmo que la cantidad de ${ingredient.name} está vigente`}
                                          checked={confirmation.confirmed}
                                          disabled={!canConfirm}
                                          onChange={(event) => setInventoryInputs((previous) => {
                                            const stored = previous[confirmationKey];
                                            const current = stored?.response === response && stored.decisionKey === decisionKey
                                              ? stored
                                              : { quantity: '', confirmed: false };
                                            return {
                                              ...previous,
                                              [confirmationKey]: {
                                                ...current,
                                                confirmed: event.target.checked && canConfirm,
                                                response,
                                                decisionKey,
                                              },
                                            };
                                          })}
                                        />
                                        Confirmo que esta cantidad está vigente para esta decisión.
                                      </label>
                                    </div>
                                  ) : (
                                    <p className="mt-1">Requerimiento o unidad no comparable; queda desconocido.</p>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                          <p className="mt-2 text-xs">El inventario solo se confirma para esta decisión y no se guarda.</p>
                        </dd>
                      </div>
                    ) : <p role="status">No hay cantidades comparables para confirmar; la disponibilidad queda desconocida.</p>}
                  </dl>
                  <fieldset className="mt-4 grid gap-2 rounded-xl border border-[#E8DDD2] p-3" aria-label={`Porciones de ${option.title}`}>
                    <legend className="px-1 text-sm font-semibold text-[#241A14]">Ajustar porciones</legend>
                    {declaredBaseServings !== null ? (
                      <p className="text-sm text-[#6B5A50]">Porciones originales declaradas: {declaredBaseServings}</p>
                    ) : (
                      <>
                        <p className="text-sm text-[#6B5A50]">Porciones originales no declaradas. Ingresá el dato de la receta para calcular.</p>
                        <label htmlFor={`today-original-servings-${index}`} className="text-sm font-medium text-[#241A14]">Porciones originales: {option.title}</label>
                        <input
                          id={`today-original-servings-${index}`}
                          type="number"
                          min="0.01"
                          step="any"
                          value={input.original}
                          onChange={(event) => updatePortionInput('original', event.target.value)}
                          className="rounded-lg border border-[#C8B9AC] px-3 py-2 text-sm"
                        />
                      </>
                    )}
                    <label htmlFor={`today-target-servings-${index}`} className="text-sm font-medium text-[#241A14]">Porciones deseadas: {option.title}</label>
                    <input
                      id={`today-target-servings-${index}`}
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      value={input.target}
                      onChange={(event) => updatePortionInput('target', event.target.value)}
                      className="rounded-lg border border-[#C8B9AC] px-3 py-2 text-sm"
                    />
                    {baseServings === null ? (
                      <p role="status" className="text-sm text-[#6B5A50]">Porciones originales desconocidas; ingresá el dato declarado para calcular.</p>
                    ) : !targetServings ? (
                      <p role="status" className="text-sm text-[#6B5A50]">Elegí cuántas porciones querés preparar.</p>
                    ) : (
                      <div aria-live="polite" className="text-sm text-[#6B5A50]">
                        <p role="status">
                          {scaling.status === 'scaled'
                            ? `Cantidades ajustadas para ${targetServings} porciones.`
                            : scaling.status === 'partial'
                              ? `Solo se ajustaron las cantidades compatibles para ${targetServings} porciones; el resto queda sin escalar.`
                              : 'No se encontraron cantidades compatibles para escalar; los valores originales quedan intactos.'}
                        </p>
                        <ul className="mt-1 grid gap-1">
                          {scaling.ingredients.map((ingredient, ingredientIndex) => (
                            <li key={`${ingredient.source}-${ingredientIndex}`}>
                              {ingredient.text}{ingredient.scaled ? '' : ' (texto de origen, sin escalar)'}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </fieldset>
                  <button
                    type="button"
                    aria-label={`Ver receta: ${option.title}`}
                    disabled={!canChoose}
                    onClick={() => {
                      if (!canChoose || targetServings === null) return;
                      onChoose({ slot: option.slot, title: option.title, ingredients: [...option.ingredients], targetServings });
                    }}
                    className="mt-4 rounded-xl bg-[#A55412] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#87440F] disabled:cursor-not-allowed disabled:bg-[#C8B9AC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A55412]"
                  >
                    Ver receta
                  </button>
                </article>
              </li>
              );
            })}
          </ul>
        </>
      )}
      {response.warnings?.includes('PROFILE_NOT_CONFIGURED') ? (
        <p role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Solo se aplican las restricciones guardadas. No se han verificado alergias ni preferencias desconocidas.
        </p>
      ) : null}
    </div>
  );
}

interface TodayRecommendationsProps {
  onChoose: (option: TodayOptionIntent) => void;
}

export default function TodayRecommendations({ onChoose }: TodayRecommendationsProps) {
  const [slot, setSlot] = useState<TodaySlot | null>(null);
  const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestGeneration = useRef(0);
  const activeRequest = useRef(0);
  const [response, setResponse] = useState<TodayResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSlot, setLoadingSlot] = useState<TodaySlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectSlot = (nextSlot: TodaySlot) => {
    if (nextSlot !== slot) requestGeneration.current += 1;
    setSlot(nextSlot);
    setResponse(null);
    setError(null);
  };

  const requestRecommendations = async () => {
    if (!slot || loading) return;
    const generation = requestGeneration.current;
    const requestId = ++activeRequest.current;
    const requestedSlot = slot;
    setLoading(true);
    setLoadingSlot(requestedSlot);
    setError(null);
    setResponse(null);
    try {
      const result = await safeFetch<TodayResponse>('/api/today', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: requestedSlot }),
      });
      if (!result.ok) throw new Error(result.error);
      if (generation === requestGeneration.current) setResponse(result.data);
    } catch (cause) {
      if (generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : 'No pudimos cargar sugerencias. Inténtalo de nuevo.');
      }
    } finally {
      if (requestId === activeRequest.current) {
        setLoading(false);
        setLoadingSlot(null);
      }
    }
  };

  return (
    <section aria-labelledby="today-recommendations-title" className="mt-6 rounded-3xl border border-[#E8DDD2] bg-gradient-to-br from-white to-[#F8F4EF] p-5 shadow-sm md:p-7">
      <div className="max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-wide text-[#A55412]">Inspiración para tu cocina</p>
        <h2 id="today-recommendations-title" className="mt-1 text-2xl font-semibold text-[#241A14]">¿Qué cocino hoy?</h2>
        <p className="mt-2 text-sm text-[#6B5A50]">Elegí un momento de comida para ver opciones basadas en tus datos disponibles.</p>
        <div role="radiogroup" aria-label="Elegí el momento de comida" className="mt-4 flex flex-wrap gap-2">
          {slots.map((item, index) => (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={slot === item.value}
              tabIndex={slot === item.value || (slot === null && index === 0) ? 0 : -1}
              ref={(element) => { radioRefs.current[index] = element; }}
              onKeyDown={(event) => {
                const nextIndex = getNextSlotIndex(index, event.key, slots.length);
                if (nextIndex === null) return;
                event.preventDefault();
                const nextSlot = slots[nextIndex].value;
                selectSlot(nextSlot);
                radioRefs.current[nextIndex]?.focus();
              }}
              onClick={() => selectSlot(item.value)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A55412] ${slot === item.value ? 'border-[#A55412] bg-[#A55412] text-white' : 'border-[#E8DDD2] bg-white text-[#6B5A50] hover:border-[#A55412]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!slot || loading}
          onClick={() => void requestRecommendations()}
          className="mt-4 rounded-xl bg-[#A55412] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#87440F] disabled:cursor-not-allowed disabled:bg-[#C8B9AC]"
        >
          {loading ? 'Buscando opciones…' : 'Ver opciones'}
        </button>
      </div>
      {loading && loadingSlot ? <p role="status" aria-live="polite" className="mt-4 text-sm text-[#6B5A50]">Buscando opciones para {slots.find((item) => item.value === loadingSlot)?.label}…</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
      {response && slot ? <TodayRecommendationResults response={response} slot={slot} onChoose={onChoose} /> : null}
    </section>
  );
}
