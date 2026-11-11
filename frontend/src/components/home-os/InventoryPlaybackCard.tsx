import type { SimulationDayState } from '@/lib/inventory/meal-plan-simulation';

type Props = {
  dayStates: SimulationDayState[];
  selectedDayIndex: number;
};

export function InventoryPlaybackCard(props: Props) {
  const selected = props.dayStates[props.selectedDayIndex] ?? null;
  const top = selected?.ingredients.slice(0, 6) ?? [];

  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">Inventory playback visual</h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Antes vs después de cada día simulado.
      </p>

      {!selected ? (
        <p className="mt-3 rounded-xl border border-bistro-border bg-white/80 p-3 text-sm text-bistro-text-secondary">
          No hay datos de simulación.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold text-bistro-text-primary">
            Después de {selected.day}
          </p>
          {top.map((item) => {
            const before = item.before;
            const after = item.after;
            const beforePct = before === null ? null : before > 0 ? 100 : 0;
            const afterPct =
              before === null || after === null || before <= 0
                ? null
                : Math.max(0, Math.min(100, Math.round((after / before) * 100)));

            return (
              <div
                key={item.normalizedName}
                className="rounded-xl border border-bistro-border bg-white/80 p-3"
              >
                <p className="text-sm font-semibold text-bistro-text-primary">
                  {item.ingredientName}
                </p>
                <div className="mt-2 space-y-2 text-xs text-bistro-text-secondary">
                  <div>
                    <p>Antes</p>
                    {beforePct === null ? (
                      <p>Sin datos para representar</p>
                    ) : (
                      <div className="mt-1 h-2 rounded-full bg-bistro-border">
                        <div
                          className="h-2 rounded-full bg-bistro-action-secondary"
                          style={{ width: `${beforePct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <p>Después</p>
                    {afterPct === null ? (
                      <p>Sin datos para representar</p>
                    ) : (
                      <div className="mt-1 h-2 rounded-full bg-bistro-border">
                        <div
                          className="h-2 rounded-full bg-bistro-action-secondary"
                          style={{ width: `${afterPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <p>
                    {after === null
                      ? 'Cantidad restante sin verificar'
                      : `${after} ${item.unit} restantes`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
