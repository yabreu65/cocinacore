'use client';

import { useRef, useState } from 'react';
import { safeFetch } from '@/lib/api';

export type TodaySlot = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type TodayOptionSource = 'provider' | 'history' | 'saved_plan' | 'saved_recipe';

export interface TodayIngredientAvailability {
  name: string;
  availability: 'sufficient' | 'partial' | 'missing' | 'unknown';
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
}

interface TodayRecommendationResultsProps {
  response: TodayResponse;
  slot: TodaySlot;
  onChoose: (option: TodayOptionIntent) => void;
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

function formatIngredientAvailability(ingredient: TodayIngredientAvailability): string {
  const required = formatAmount(ingredient.requiredQuantity, ingredient.requiredUnit);
  const available = formatAmount(ingredient.availableQuantity, ingredient.availableUnit);
  const missing = formatAmount(ingredient.missingQuantity, ingredient.requiredUnit);
  return [
    `${ingredient.name}: ${required ? `requiere ${required}` : 'requerimiento no cuantificable'}`,
    available ? `disponible ${available}` : 'inventario no verificable',
    missing ? `faltan ${missing}` : 'faltante no calculable',
  ].join('; ');
}

const sourceLabels: Record<TodayOptionSource, string> = {
  provider: 'sugerencia nueva',
  history: 'historial reciente',
  saved_plan: 'plan guardado',
  saved_recipe: 'receta guardada',
};

export function TodayRecommendationResults({ response, slot, onChoose }: TodayRecommendationResultsProps) {
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
            {options.map((option, index) => (
              <li key={`${option.title}-${index}`} role="listitem" className="rounded-2xl border border-[#E8DDD2] bg-white p-5 shadow-sm">
                <article aria-labelledby={`today-option-${index}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h4 id={`today-option-${index}`} className="text-lg font-semibold text-[#241A14]">{option.title}</h4>
                    <span className="rounded-full bg-[#F8F4EF] px-3 py-1 text-xs font-semibold text-[#6B5A50]">{slotLabel}</span>
                  </div>
                  <p className="mt-2 text-sm text-[#6B5A50]">{option.reason}</p>
                  <p className="mt-1 text-xs text-[#6B5A50]">Origen: {sourceLabels[option.source]}</p>
                  <p className="mt-2 text-sm text-[#6B5A50]">
                    {option.prepMinutes === null ? 'Tiempo no estimado' : `${option.prepMinutes} minutos`}
                  </p>
                  <dl className="mt-3 grid gap-2 text-sm">
                    <div><dt className="inline font-semibold text-[#241A14]">Disponible: </dt><dd className="inline text-[#6B5A50]">{option.availableIngredients.length ? option.availableIngredients.join(', ') : 'ningún ingrediente confirmado'}</dd></div>
                    <div><dt className="inline font-semibold text-[#241A14]">Falta: </dt><dd className="inline text-[#6B5A50]">{option.missingIngredients.length ? option.missingIngredients.join(', ') : 'sin faltantes confirmados'}</dd></div>
                    {option.unknownIngredients?.length ? (
                      <div><dt className="inline font-semibold text-[#241A14]">Sin verificar: </dt><dd className="inline text-[#6B5A50]">{option.unknownIngredients.join(', ')}</dd></div>
                    ) : null}
                    {option.ingredientAvailability?.length ? (
                      <div>
                        <dt className="font-semibold text-[#241A14]">Detalle de cantidades</dt>
                        <dd className="text-[#6B5A50]">
                          Cantidades de origen; no ajustadas por porciones.
                          <ul className="mt-1 grid gap-1">
                            {option.ingredientAvailability.map((ingredient, ingredientIndex) => (
                              <li key={`${ingredient.name}-${ingredientIndex}`}>{formatIngredientAvailability(ingredient)}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <button
                    type="button"
                    aria-label={`Ver receta: ${option.title}`}
                    onClick={() => onChoose({ slot: option.slot, title: option.title, ingredients: [...option.ingredients] })}
                    className="mt-4 rounded-xl bg-[#A55412] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#87440F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#A55412]"
                  >
                    Ver receta
                  </button>
                </article>
              </li>
            ))}
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
