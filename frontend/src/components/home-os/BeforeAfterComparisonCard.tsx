import type { MealPlanComparison } from '@/lib/inventory/meal-plan-optimizer';

type Props = {
  comparison: MealPlanComparison;
};

function deltaLabel(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

function deltaTone(delta: number): string {
  if (delta > 0) return 'text-[#567A3B]';
  if (delta < 0) return 'text-[#B84D4D]';
  return 'text-[#6B5A50]';
}

export function BeforeAfterComparisonCard({ comparison }: Props) {
  const items = [
    { label: 'Costo', before: comparison.before.cost, after: comparison.after.cost, delta: comparison.deltas.cost },
    { label: 'Reutilización', before: comparison.before.reuse, after: comparison.after.reuse, delta: comparison.deltas.reuse },
    { label: 'Faltantes', before: comparison.before.missing, after: comparison.after.missing, delta: comparison.deltas.missing },
    { label: 'Frescura', before: comparison.before.freshness, after: comparison.after.freshness, delta: comparison.deltas.freshness },
  ];

  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold">Antes vs después</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Comparación de impacto en la simulación actual.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-2">
            <p className="text-xs text-[#6B5A50] break-words">{item.label}</p>
            <p className="text-sm font-semibold text-[#241A14]">
              {item.before} → {item.after}
            </p>
            <p className={`text-xs font-semibold ${deltaTone(item.delta)}`}>{deltaLabel(item.delta)}</p>
          </div>
        ))}
      </div>
    </article>
  );
}
