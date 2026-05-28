import type { SimulationDayState } from '@/lib/inventory/meal-plan-simulation';

type Props = {
  dayStates: SimulationDayState[];
  selectedDayIndex: number;
};

export function InventoryPlaybackCard(props: Props) {
  const selected = props.dayStates[props.selectedDayIndex] ?? null;
  const top = selected?.ingredients.slice(0, 6) ?? [];

  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Inventory playback visual</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Antes vs después de cada día simulado.</p>

      {!selected ? (
        <p className="mt-3 rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm text-[#6B5A50]">No hay datos de simulación.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold text-[#241A14]">Después de {selected.day}</p>
          {top.map((item) => {
            const before = item.before ?? 0;
            const after = item.after ?? 0;
            const beforePct = before > 0 ? 100 : 0;
            const afterPct = before > 0 ? Math.max(0, Math.min(100, Math.round((after / before) * 100))) : 0;

            return (
              <div key={item.normalizedName} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
                <p className="text-sm font-semibold text-[#241A14]">{item.ingredientName}</p>
                <div className="mt-2 space-y-2 text-xs text-[#6B5A50]">
                  <div>
                    <p>Antes</p>
                    <div className="mt-1 h-2 rounded-full bg-[#E8DDD2]">
                      <div className="h-2 rounded-full bg-[#6D4AFF]" style={{ width: `${beforePct}%` }} />
                    </div>
                  </div>
                  <div>
                    <p>Después</p>
                    <div className="mt-1 h-2 rounded-full bg-[#E8DDD2]">
                      <div className="h-2 rounded-full bg-[#567A3B]" style={{ width: `${afterPct}%` }} />
                    </div>
                  </div>
                  <p>{after} {item.unit} restantes</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
