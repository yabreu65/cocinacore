import type { SimulationDayState } from '@/lib/inventory/meal-plan-simulation';

type Props = {
  dayState: SimulationDayState | null;
  message: string;
};

export function DailyKitchenCard(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">Hoy en tu cocina</h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">{props.message}</p>

      {!props.dayState ? (
        <p className="mt-3 rounded-xl border border-bistro-border bg-white/80 p-3 text-sm text-bistro-text-secondary">
          Simulá un día para ver impacto real del menú.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold text-bistro-text-primary">{props.dayState.day}</p>
          <ul className="space-y-2">
            {props.dayState.meals.map((meal) => (
              <li
                key={`${props.dayState?.day}-${meal.label}`}
                className="rounded-xl border border-bistro-border bg-white/80 p-2"
              >
                <p className="text-sm font-semibold text-bistro-text-primary">{meal.label}</p>
                <p className="text-sm text-bistro-text-secondary line-clamp-1">{meal.title}</p>
              </li>
            ))}
          </ul>
          <p className="rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-xs text-bistro-text-secondary">
            Ingredientes en estado crítico hoy:{' '}
            <span className="font-semibold">{props.dayState.summary.criticalCount}</span>
          </p>
        </div>
      )}
    </article>
  );
}
