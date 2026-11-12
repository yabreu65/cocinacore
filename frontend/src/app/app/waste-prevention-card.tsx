'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { safeFetch } from '@/lib/api';
import type {
  WasteExpiryStatus,
  WasteRecipeCoverage,
  WasteRecipeIngredientEvidence,
} from '@/lib/waste-prevention';

type WasteLot = {
  lotId: string;
  ingredientName: string;
  status: WasteExpiryStatus;
  calendarDate: string | null;
  daysRemaining: number | null;
  reason?: string;
  expirationDate: string | null;
  quantity: string | null;
  unit: string | null;
  quantityStatus: 'known' | 'unknown';
};

type WasteSuggestion = {
  recipeId: string;
  title: string;
  coverage: WasteRecipeCoverage;
  matchedIngredientCount: number;
  requiredIngredientCount: number;
  expiringLotCount: number;
  earliestUpcomingLotDate: string | null;
  ingredients: WasteRecipeIngredientEvidence[];
};

export type WastePreventionViewReport = {
  status: 'ready' | 'unknown';
  reason?: string;
  asOfDate: string | null;
  timeZone: string;
  windowDays: number;
  lots: WasteLot[];
  suggestions: WasteSuggestion[];
};

type WastePreventionResponse = {
  report: WastePreventionViewReport;
  profileConfigured: boolean;
};

function lotLabel(lot: WasteLot): string {
  if (lot.status === 'expired') return 'Vencido';
  if (lot.status === 'due_today') return 'Vence hoy';
  if (lot.status === 'due_soon') return 'Vence pronto';
  if (lot.status === 'unknown') return 'Fecha no confirmada';
  return 'Vencimiento posterior';
}

function lotDescription(lot: WasteLot): string {
  const quantity =
    lot.quantityStatus === 'known' && lot.quantity
      ? `${lot.quantity}${lot.unit ? ` ${lot.unit}` : ''}`
      : 'Cantidad no registrada';
  if (lot.status === 'unknown') return `${quantity}. No se puede priorizar sin una fecha válida.`;
  const dayText =
    lot.daysRemaining === 0
      ? 'Vence hoy.'
      : lot.daysRemaining !== null && lot.daysRemaining > 0
        ? `${lot.daysRemaining} día${lot.daysRemaining === 1 ? '' : 's'} restantes.`
        : lot.daysRemaining !== null
          ? `Vencido hace ${Math.abs(lot.daysRemaining)} día${Math.abs(lot.daysRemaining) === 1 ? '' : 's'}.`
          : 'Tiempo restante desconocido.';
  return `${quantity}. ${dayText} Fecha registrada: ${lot.calendarDate ?? 'desconocida'}.`;
}

function coverageLabel(coverage: WasteRecipeCoverage): string {
  if (coverage === 'full') return 'Ingredientes suficientes según los datos registrados';
  if (coverage === 'partial') return 'Cobertura parcial; revisá lo que falta';
  return 'Cobertura desconocida por cantidades o unidades no comparables';
}

function WastePreventionPanel({
  report,
  profileConfigured,
}: {
  report: WastePreventionViewReport;
  profileConfigured: boolean;
}) {
  const expired = report.lots.filter((lot) => lot.status === 'expired');
  const dueSoon = report.lots.filter(
    (lot) => lot.status === 'due_today' || lot.status === 'due_soon'
  );
  const unknown = report.lots.filter((lot) => lot.status === 'unknown');
  const suggestions = profileConfigured ? report.suggestions : [];

  return (
    <section
      aria-labelledby="waste-prevention-title"
      className="mt-6 rounded-3xl border border-bistro-border bg-white/90 p-5 shadow-sm md:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-bistro-action-primary">
            Aprovechamiento cuidadoso
          </p>
          <h2
            id="waste-prevention-title"
            className="mt-1 text-2xl font-semibold text-bistro-text-primary"
          >
            Ingredientes para revisar
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-bistro-text-secondary">
            Priorizamos fechas registradas y recetas guardadas compatibles. Las sugerencias son
            informativas y no cambian tu inventario.
          </p>
        </div>
        <Link
          href="/recipes/inventory"
          className="rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-action-primary hover:bg-bistro-surface-warm"
        >
          Revisar inventario
        </Link>
      </div>

      {report.status === 'unknown' ? (
        <p
          role="status"
          className="mt-5 rounded-xl border border-bistro-warning/30 bg-bistro-warning/10 px-4 py-3 text-sm text-bistro-warning"
        >
          No pudimos establecer una fecha de referencia segura. Las recomendaciones quedan pausadas
          para no adivinar vencimientos.
        </p>
      ) : null}

      {!profileConfigured ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-bistro-border bg-bistro-surface-warm px-4 py-3 text-sm text-bistro-text-secondary"
        >
          No hay un perfil culinario completo; no se pueden verificar preferencias o alergias
          desconocidas. Las sugerencias quedan pausadas hasta configurarlo.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-bistro-border bg-bistro-page p-4">
          <h3 className="font-semibold text-bistro-text-primary">Próximos a vencer</h3>
          {dueSoon.length > 0 ? (
            <ul className="mt-3 grid gap-2" aria-label="Ingredientes próximos a vencer">
              {dueSoon.map((lot) => (
                <li
                  key={lot.lotId}
                  className="rounded-xl border border-bistro-border bg-white px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-bistro-text-primary">
                      {lot.ingredientName}
                    </span>
                    <span className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs font-semibold text-bistro-action-primary">
                      {lotLabel(lot)}
                    </span>
                  </div>
                  <p className="mt-1 text-bistro-text-secondary">{lotDescription(lot)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-bistro-text-secondary">
              No hay fechas registradas dentro de los próximos {report.windowDays} días.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-bistro-border bg-white p-4">
          <h3 className="font-semibold text-bistro-text-primary">Vencidos y datos incompletos</h3>
          {expired.length > 0 ? (
            <ul className="mt-3 grid gap-2" aria-label="Ingredientes vencidos">
              {expired.map((lot) => (
                <li
                  key={lot.lotId}
                  className="rounded-xl border border-bistro-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-bistro-text-primary">
                      {lot.ingredientName}
                    </span>
                    <span className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs font-semibold text-bistro-text-secondary">
                      {lotLabel(lot)}
                    </span>
                  </div>
                  <p className="mt-1 text-bistro-text-secondary">
                    {lotDescription(lot)} No se recomienda consumirlo.
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {unknown.length > 0 ? (
            <ul className="mt-3 grid gap-2" aria-label="Ingredientes sin fecha confirmada">
              {unknown.map((lot) => (
                <li
                  key={lot.lotId}
                  className="rounded-xl border border-dashed border-bistro-border px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-bistro-text-primary">
                      {lot.ingredientName}
                    </span>
                    <span className="rounded-full bg-bistro-surface-warm px-2 py-1 text-xs font-semibold text-bistro-text-secondary">
                      {lotLabel(lot)}
                    </span>
                  </div>
                  <p className="mt-1 text-bistro-text-secondary">{lotDescription(lot)}</p>
                </li>
              ))}
            </ul>
          ) : null}
          {expired.length === 0 && unknown.length === 0 ? (
            <p className="mt-3 text-sm text-bistro-text-secondary">
              No hay lotes vencidos ni fechas incompletas en los datos recibidos.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-bistro-border bg-bistro-surface-warm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-bistro-text-primary">
            Recetas que podrían aprovecharlos
          </h3>
          <Link href="/recipes" className="text-sm font-semibold text-bistro-action-primary">
            Ver biblioteca
          </Link>
        </div>
        {suggestions.length > 0 ? (
          <ul
            className="mt-3 grid gap-3 md:grid-cols-2"
            aria-label="Recetas compatibles para aprovechar ingredientes"
          >
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.recipeId}
                className="rounded-xl border border-bistro-border bg-white p-3"
              >
                <Link
                  href={`/recipes/${suggestion.recipeId}`}
                  className="font-semibold text-bistro-action-primary hover:underline"
                >
                  {suggestion.title}
                </Link>
                <p className="mt-1 text-sm text-bistro-text-secondary">
                  {coverageLabel(suggestion.coverage)}
                </p>
                <p className="mt-1 text-xs text-bistro-text-secondary">
                  {suggestion.expiringLotCount} lote{suggestion.expiringLotCount === 1 ? '' : 's'}{' '}
                  con prioridad de vencimiento.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-bistro-text-secondary">
            No encontramos una receta guardada con evidencia suficiente y compatible para estos
            ingredientes.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-bistro-text-secondary">
        Referencia: {report.asOfDate ?? 'desconocida'} · Zona horaria: {report.timeZone}. Confirmá
        siempre el estado real del alimento antes de cocinar.
      </p>
    </section>
  );
}

export { WastePreventionPanel };

export default function WastePreventionCard() {
  const [response, setResponse] = useState<WastePreventionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const load = async () => {
      try {
        const result = await safeFetch<WastePreventionResponse>(
          `/api/waste-prevention?timeZone=${encodeURIComponent(timeZone)}&dueSoonDays=5`,
          { credentials: 'same-origin' }
        );
        if (!result.ok) throw new Error(result.error);
        setResponse(result.data);
      } catch {
        setError(
          'No pudimos revisar los vencimientos en este momento. Intentá nuevamente más tarde.'
        );
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <section
        aria-labelledby="waste-prevention-title"
        className="mt-6 rounded-3xl border border-bistro-border bg-white/90 p-5 shadow-sm md:p-7"
      >
        <h2 id="waste-prevention-title" className="font-semibold text-bistro-text-primary">
          Ingredientes para revisar
        </h2>
        <p role="status" className="mt-3 text-sm text-bistro-text-secondary">
          Revisando fechas registradas...
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section
        aria-labelledby="waste-prevention-title"
        className="mt-6 rounded-3xl border border-bistro-danger/30 bg-bistro-danger/10 p-5 md:p-7"
      >
        <h2 id="waste-prevention-title" className="font-semibold text-bistro-danger">
          Ingredientes para revisar
        </h2>
        <p role="alert" className="mt-3 text-sm text-bistro-danger">
          {error}
        </p>
        <Link
          href="/recipes/inventory"
          className="mt-3 inline-block text-sm font-semibold text-bistro-danger underline"
        >
          Abrir inventario
        </Link>
      </section>
    );
  }
  return response ? (
    <WastePreventionPanel report={response.report} profileConfigured={response.profileConfigured} />
  ) : null;
}
