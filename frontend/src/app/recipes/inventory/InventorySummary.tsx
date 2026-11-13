import { Package, AlertTriangle, Wallet } from 'lucide-react';
import type { summarizeInventory } from '@/lib/inventory/inventory-overview';

export function InventorySummary({
  summary,
  loading,
  dataReady,
}: {
  summary: ReturnType<typeof summarizeInventory>;
  loading: boolean;
  dataReady: boolean;
}) {
  return (
    <section
      aria-label="Resumen del inventario"
      aria-busy={loading}
      className="grid gap-3 sm:grid-cols-3"
    >
      <article className="rounded-2xl bg-bistro-action-secondary p-4 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Package size={19} aria-hidden="true" /> Ingredientes
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {dataReady ? summary.count : '—'}
        </p>
        <p className="mt-1 text-xs">
          {dataReady ? `${summary.needsReview} con datos por revisar` : 'Información no disponible'}
        </p>
      </article>
      <article className="rounded-2xl border border-bistro-border bg-bistro-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-bistro-warning">
          <AlertTriangle size={19} aria-hidden="true" /> Atención necesaria
        </div>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {dataReady ? summary.alerts : '—'}
        </p>
        <p className="mt-1 text-xs text-bistro-text-secondary">
          {dataReady
            ? `${summary.lowStock} stock bajo/agotado · ${summary.expiring} vencidos/próximos`
            : 'Información no disponible'}
        </p>
      </article>
      <article className="min-w-0 rounded-2xl border border-bistro-border bg-bistro-surface p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-bistro-action-secondary">
          <Wallet size={19} aria-hidden="true" /> Valor conocido {summary.currency ?? ''}
        </div>
        <p className="mt-2 break-all text-2xl font-semibold tabular-nums">
          {dataReady && summary.knownValue !== null
            ? `${summary.currency} ${summary.knownValue}`
            : '—'}
        </p>
        <p className="mt-1 text-xs text-bistro-text-secondary">
          {!dataReady
            ? 'Información no disponible'
            : !summary.currency
              ? 'Configura la moneda de trabajo'
              : `${summary.valued} de ${summary.count} con valor calculable · ${summary.unvalued} excluidos`}
        </p>
      </article>
    </section>
  );
}
