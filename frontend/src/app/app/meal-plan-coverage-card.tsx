'use client';

import { useCallback, useEffect, useRef, useState, type FormEventHandler } from 'react';
import Link from 'next/link';
import { safeFetch } from '@/lib/api';
import type { MealPlanCoverageForecast } from '@/lib/meal-planner/coverage-forecast';

type CoverageApiResponse = {
  mealPlanId: string | null;
  peopleCount: number | null;
  forecast: MealPlanCoverageForecast;
};

type MealPlanCoveragePanelProps = {
  forecast: MealPlanCoverageForecast | null;
  mealPlanId: string | null;
  peopleCount: number | null;
  horizonDays: 7 | 14;
  loading: boolean;
  error: string | null;
  startDate: string;
  timeZone: string;
  isScheduling: boolean;
  portionBasisConfirmed: boolean;
  scheduleError: string | null;
  scheduleMessage: string | null;
  onHorizonChange: (horizonDays: 7 | 14) => void;
  onStartDateChange: (value: string) => void;
  onPortionBasisConfirmationChange: (confirmed: boolean) => void;
  onConfirmSchedule: FormEventHandler<HTMLFormElement>;
};

export const loadCoverageAtCurrentHorizon = (
  selectedHorizon: { current: 7 | 14 },
  loadCoverage: (days: 7 | 14) => Promise<void>
) => loadCoverage(selectedHorizon.current);

const STATUS_LABELS = {
  sufficient: 'Suficiente',
  partial: 'Parcial',
  missing: 'Faltante',
  unknown: 'Desconocida',
} as const;

function formatAmount(quantity: number | null, unit: string): string | null {
  if (quantity === null || unit === 'unknown' || !Number.isFinite(quantity)) return null;
  return `${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(quantity)} ${unit}`;
}

export function MealPlanCoveragePanel({
  forecast,
  mealPlanId,
  peopleCount,
  horizonDays,
  loading,
  error,
  startDate,
  timeZone,
  isScheduling,
  portionBasisConfirmed,
  scheduleError,
  scheduleMessage,
  onHorizonChange,
  onStartDateChange,
  onPortionBasisConfirmationChange,
  onConfirmSchedule,
}: MealPlanCoveragePanelProps) {
  const needsSchedule =
    forecast?.status === 'unknown' && forecast.reason === 'schedule_not_confirmed';
  const needsPortionConfirmation =
    forecast?.status === 'unknown' && forecast.reason === 'portion_basis_not_confirmed';
  const hasNoPlan = forecast?.status === 'unknown' && forecast.reason === 'no_saved_plan';
  const planTooShort =
    forecast?.status === 'unknown' && forecast.reason === 'plan_does_not_cover_horizon';

  return (
    <section
      aria-labelledby="meal-plan-coverage-title"
      className="mt-6 rounded-2xl border border-bistro-border bg-white/90 p-4 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2
            id="meal-plan-coverage-title"
            className="text-lg font-semibold text-bistro-text-primary"
          >
            Cobertura de ingredientes
          </h2>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            Proyección basada en inventario cuantificado, agenda confirmada y comidas pendientes.
          </p>
        </div>
        <div role="group" aria-label="Horizonte de cobertura" className="flex gap-2">
          {[7, 14].map((days) => (
            <button
              key={days}
              type="button"
              aria-label={`Horizonte de ${days} días`}
              aria-pressed={horizonDays === days}
              onClick={() => onHorizonChange(days as 7 | 14)}
              className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold ${
                horizonDays === days
                  ? 'border-bistro-action-primary bg-bistro-action-primary text-white'
                  : 'border-bistro-border bg-white text-bistro-text-secondary'
              }`}
            >
              {days} días
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p role="status" className="mt-4 text-sm text-bistro-text-secondary">
          Calculando cobertura…
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-bistro-danger/10 p-3 text-sm text-bistro-danger"
        >
          {error}
        </p>
      ) : null}
      {scheduleError ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-bistro-danger/10 p-3 text-sm text-bistro-danger"
        >
          {scheduleError}
        </p>
      ) : null}
      {scheduleMessage ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-bistro-success/10 p-3 text-sm text-bistro-success"
        >
          {scheduleMessage}
        </p>
      ) : null}

      {!loading && forecast?.status === 'unknown' ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 p-4 text-sm text-bistro-warning"
        >
          {needsSchedule || needsPortionConfirmation ? (
            <>
              {needsSchedule ? (
                <p>
                  Cobertura desconocida: este menú todavía no tiene una fecha futura confirmada. No
                  inferimos fechas ni suponemos que el inventario ausente sea cero.
                </p>
              ) : (
                <p>
                  Cobertura desconocida: revisá las cantidades del menú guardado y confirmá que
                  corresponden a {peopleCount ?? 'las'} porciones. No escalamos ni inferimos
                  cantidades.
                </p>
              )}
              {mealPlanId ? (
                <form onSubmit={onConfirmSchedule} className="mt-4 grid gap-3">
                  <div className="grid gap-1">
                    <label htmlFor="meal-plan-start-date" className="font-semibold">
                      Fecha de inicio del plan
                    </label>
                    <input
                      id="meal-plan-start-date"
                      type="date"
                      required
                      value={startDate}
                      onChange={(event) => onStartDateChange(event.target.value)}
                      className="min-h-11 rounded-xl border border-bistro-border bg-white px-3 py-2"
                    />
                    <span className="text-xs">Zona horaria: {timeZone}</span>
                  </div>
                  <label htmlFor="meal-plan-portions-confirmed" className="flex items-start gap-2">
                    <input
                      id="meal-plan-portions-confirmed"
                      type="checkbox"
                      required
                      checked={portionBasisConfirmed}
                      onChange={(event) => onPortionBasisConfirmationChange(event.target.checked)}
                      className="mt-1 size-4 rounded border-bistro-border"
                    />
                    <span>
                      Confirmo que revisé las cantidades del menú y corresponden a{' '}
                      {peopleCount ?? 'las'} porciones.
                    </span>
                  </label>
                  <button
                    type="submit"
                    disabled={!startDate || !portionBasisConfirmed || isScheduling}
                    className="min-h-11 rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isScheduling ? 'Guardando…' : 'Confirmar agenda y porciones'}
                  </button>
                </form>
              ) : null}
            </>
          ) : hasNoPlan ? (
            <>
              <p>Cobertura desconocida: todavía no hay un menú guardado para proyectar.</p>
              <Link
                href="/meal-planner"
                className="mt-3 inline-block font-semibold text-bistro-action-primary underline"
              >
                Abrir el planificador
              </Link>
            </>
          ) : planTooShort ? (
            <p>
              El menú confirmado no cubre los {forecast.horizonDays} días del horizonte. Elegí 7
              días o generá un plan más largo y confirmá su agenda.
            </p>
          ) : (
            <p>
              Cobertura desconocida; no hay evidencia suficiente para calcular cantidades sin
              inferir.
            </p>
          )}
        </div>
      ) : null}

      {!loading && forecast?.status === 'ready' ? (
        <div className="mt-4" aria-live="polite">
          <p className="text-sm text-bistro-text-secondary">
            Del {forecast.fromDate} al {forecast.throughDate} · {forecast.timeZone}
            {peopleCount ? ` · ${peopleCount} porciones` : ''}
          </p>
          <p className="mt-1 text-xs text-bistro-text-secondary">
            {forecast.scheduledMealCount} comidas programadas; {forecast.consumedMealCount}{' '}
            consumidas y excluidas del consumo futuro.
          </p>
          {forecast.items.length === 0 ? (
            <p
              role="status"
              className="mt-3 rounded-xl bg-bistro-surface-warm p-3 text-sm text-bistro-text-secondary"
            >
              No hay requerimientos pendientes cuantificables en este horizonte.
            </p>
          ) : (
            <ul role="list" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {forecast.items.map((item) => (
                <li
                  key={item.normalizedName}
                  role="listitem"
                  className="rounded-xl border border-bistro-border bg-white p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold text-bistro-text-primary">
                      {item.ingredientName}
                    </h3>
                    <span className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs font-semibold text-bistro-text-secondary">
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <dl className="mt-2 grid gap-1 text-sm text-bistro-text-secondary">
                    <div>
                      <dt className="inline font-semibold">Requiere: </dt>
                      <dd className="inline">
                        {formatAmount(item.requiredTotalQuantity, item.requiredUnit) ??
                          'cantidad desconocida'}
                      </dd>
                    </div>
                    {item.status === 'unknown' ? (
                      <div>
                        <dt className="font-semibold">Disponibilidad desconocida</dt>
                        <dd>No se presume stock ni faltante.</dd>
                      </div>
                    ) : (
                      <>
                        <div>
                          <dt className="inline font-semibold">Disponible: </dt>
                          <dd className="inline">
                            {formatAmount(item.availableQuantity, item.availableUnit) ??
                              'cantidad desconocida'}
                          </dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold">Faltan: </dt>
                          <dd className="inline">
                            {formatAmount(item.missingQuantity, item.requiredUnit) ??
                              'cantidad desconocida'}
                          </dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt className="inline font-semibold">Usado en: </dt>
                      <dd className="inline">
                        {item.usedInRecipes.join(', ') || 'plan confirmado'}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export default function MealPlanCoverageCard() {
  const [horizonDays, setHorizonDays] = useState<7 | 14>(7);
  const [data, setData] = useState<CoverageApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [timeZone] = useState(getBrowserTimeZone);
  const [portionBasisConfirmed, setPortionBasisConfirmed] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);
  const horizonDaysRef = useRef(horizonDays);
  const requestVersion = useRef(0);

  const loadCoverage = useCallback(async (days: 7 | 14) => {
    const currentVersion = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await safeFetch<CoverageApiResponse>(
        `/api/meal-plan/coverage?horizonDays=${days}`,
        { credentials: 'same-origin' }
      );
      if (requestVersion.current !== currentVersion) return;
      if (!result.ok) throw new Error(result.error ?? 'No se pudo calcular la cobertura.');
      setData(result.data);
    } catch (loadError) {
      if (requestVersion.current === currentVersion) {
        setError(
          loadError instanceof Error ? loadError.message : 'No se pudo calcular la cobertura.'
        );
        setData(null);
      }
    } finally {
      if (requestVersion.current === currentVersion) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCoverage(horizonDays);
    return () => {
      requestVersion.current += 1;
    };
  }, [horizonDays, loadCoverage]);

  const onConfirmSchedule: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    if (!data?.mealPlanId || !startDate || !portionBasisConfirmed || isScheduling) return;

    setIsScheduling(true);
    setScheduleError(null);
    setScheduleMessage(null);
    try {
      const result = await safeFetch<{ schedule: { startDate: string } }>(
        '/api/meal-plan/schedule',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            mealPlanId: data.mealPlanId,
            startDate,
            timeZone,
            confirmed: true,
            portionBasisConfirmed: true,
          }),
        }
      );
      if (!result.ok) throw new Error(result.error ?? 'No se pudo confirmar la agenda.');
      setScheduleMessage(`Agenda y porciones confirmadas para ${result.data.schedule.startDate}.`);
      await loadCoverageAtCurrentHorizon(horizonDaysRef, loadCoverage);
    } catch (scheduleFailure) {
      setScheduleError(
        scheduleFailure instanceof Error
          ? scheduleFailure.message
          : 'No se pudo confirmar la agenda.'
      );
    } finally {
      setIsScheduling(false);
    }
  };

  const handleHorizonChange = (days: 7 | 14) => {
    horizonDaysRef.current = days;
    setHorizonDays(days);
  };

  return (
    <MealPlanCoveragePanel
      forecast={data?.forecast ?? null}
      mealPlanId={data?.mealPlanId ?? null}
      peopleCount={data?.peopleCount ?? null}
      horizonDays={horizonDays}
      loading={loading}
      error={error}
      startDate={startDate}
      timeZone={timeZone}
      isScheduling={isScheduling}
      portionBasisConfirmed={portionBasisConfirmed}
      scheduleError={scheduleError}
      scheduleMessage={scheduleMessage}
      onHorizonChange={handleHorizonChange}
      onStartDateChange={setStartDate}
      onPortionBasisConfirmationChange={setPortionBasisConfirmed}
      onConfirmSchedule={onConfirmSchedule}
    />
  );
}
