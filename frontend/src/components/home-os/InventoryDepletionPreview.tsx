import type { MealPlanProjectionItem } from '@/lib/inventory/meal-plan-projection';

type Props = {
  items: MealPlanProjectionItem[];
};

function ratio(item: MealPlanProjectionItem): number | null {
  if (
    item.availableQuantity === null ||
    item.requiredTotalQuantity === null ||
    item.availableQuantity <= 0 ||
    item.projectedRemainingQuantity === null
  )
    return null;
  const remaining = item.projectedRemainingQuantity;
  return Math.max(0, Math.min(1, remaining / item.availableQuantity));
}

function depletionStatus(
  item: MealPlanProjectionItem
): 'suficiente' | 'bajo' | 'critico' | 'revisar' {
  if (item.status === 'unknown') return 'revisar';
  if (item.status === 'missing') return 'critico';
  if (item.status === 'partial') return 'bajo';
  return 'suficiente';
}

export function InventoryDepletionPreview(props: Props) {
  const topItems = props.items.slice(0, 8);

  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">
        Simulación operativa del menú
      </h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Vista previa antes/después del menú. No modifica tu inventario real.
      </p>

      <div className="mt-3 space-y-3">
        {topItems.map((item) => {
          const itemRatio = ratio(item);
          const status = depletionStatus(item);
          const statusTone =
            status === 'suficiente'
              ? 'text-bistro-success'
              : status === 'bajo'
                ? 'text-bistro-warning'
                : status === 'critico'
                  ? 'text-bistro-danger'
                  : 'text-bistro-text-secondary';

          return (
            <div
              key={item.normalizedName}
              className="rounded-xl border border-bistro-border bg-white/80 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-bistro-text-primary">
                  {item.ingredientName}
                </p>
                <span className={`text-xs font-semibold ${statusTone}`}>{status}</span>
              </div>

              <div className="mt-2 grid gap-1 text-xs text-bistro-text-secondary">
                <p>
                  Antes: {item.availableQuantity ?? '—'} {item.availableUnit}
                </p>
                <p>
                  Después: {item.projectedRemainingQuantity ?? '—'} {item.requiredUnit}
                </p>
              </div>

              {itemRatio === null ? (
                <p className="mt-2 text-xs text-bistro-text-secondary">
                  Sin datos suficientes para calcular el nivel restante.
                </p>
              ) : (
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-bistro-border">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-bistro-action-secondary to-bistro-action-secondary"
                    style={{ width: `${Math.round(itemRatio * 100)}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {topItems.length === 0 ? (
          <div className="rounded-xl border border-bistro-border bg-white/80 p-3 text-sm text-bistro-text-secondary">
            Generá inventario sugerido para ver la simulación de consumo.
          </div>
        ) : null}
      </div>
    </article>
  );
}
