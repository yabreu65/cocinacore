import type { MealPlanProjectionItem } from '@/lib/inventory/meal-plan-projection';

type Props = {
  items: MealPlanProjectionItem[];
};

function ratio(item: MealPlanProjectionItem): number | null {
  if (item.availableQuantity === null || item.requiredTotalQuantity === null || item.availableQuantity <= 0) return null;
  const remaining = item.projectedRemainingQuantity ?? 0;
  return Math.max(0, Math.min(1, remaining / item.availableQuantity));
}

function depletionStatus(item: MealPlanProjectionItem): 'suficiente' | 'bajo' | 'critico' | 'revisar' {
  if (item.status === 'unknown') return 'revisar';
  if (item.status === 'missing') return 'critico';
  if (item.status === 'partial') return 'bajo';
  return 'suficiente';
}

export function InventoryDepletionPreview(props: Props) {
  const topItems = props.items.slice(0, 8);

  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Simulación operativa del menú</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Vista previa antes/después del menú. No modifica tu inventario real.</p>

      <div className="mt-3 space-y-3">
        {topItems.map((item) => {
          const itemRatio = ratio(item);
          const status = depletionStatus(item);
          const statusTone =
            status === 'suficiente'
              ? 'text-emerald-700'
              : status === 'bajo'
                ? 'text-amber-700'
                : status === 'critico'
                  ? 'text-red-700'
                  : 'text-[#6B5A50]';

          return (
            <div key={item.normalizedName} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#241A14]">{item.ingredientName}</p>
                <span className={`text-xs font-semibold ${statusTone}`}>{status}</span>
              </div>

              <div className="mt-2 grid gap-1 text-xs text-[#6B5A50]">
                <p>Antes: {item.availableQuantity ?? '—'} {item.availableUnit}</p>
                <p>Después: {item.projectedRemainingQuantity ?? '—'} {item.requiredUnit}</p>
              </div>

              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E8DDD2]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#6D4AFF] to-[#567A3B]"
                  style={{ width: `${itemRatio === null ? 0 : Math.round(itemRatio * 100)}%` }}
                />
              </div>
            </div>
          );
        })}

        {topItems.length === 0 ? (
          <div className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm text-[#6B5A50]">
            Generá inventario sugerido para ver la simulación de consumo.
          </div>
        ) : null}
      </div>
    </article>
  );
}
