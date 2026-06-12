import { ArrowDown, ArrowUp, GripVertical, Lock, Unlock } from 'lucide-react';

type MealType = 'Desayuno' | 'Almuerzo' | 'Cena';

type PlannerMealCard = {
  name: string;
  time: string;
  difficulty: 'Fácil' | 'Media' | 'Alta';
  badge: string;
  fusionTag: string;
  missing: number;
  aiScore: number;
};

type PlannerDay = {
  day: string;
  meals: Record<MealType, PlannerMealCard>;
};

type Props = {
  days: PlannerDay[];
  lockedMeals: string[];
  onToggleLock: (day: string, mealType: MealType) => void;
  onMoveDay: (dayIndex: number, mealType: MealType, dir: -1 | 1) => void;
  onMoveMealSlot: (dayIndex: number, mealType: MealType, dir: -1 | 1) => void;
  onSimulateDay: (dayIndex: number) => void;
  selectedDayIndex: number;
};

const MEALS: MealType[] = ['Desayuno', 'Almuerzo', 'Cena'];

function mealKey(day: string, mealType: MealType): string {
  return `${day}::${mealType}`;
}

export function EditableMealTimeline(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Timeline editable del menú</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">
        Mové recetas entre días/comidas y recalculá la simulación en tiempo real.
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {props.days.map((day, dayIndex) => (
          <section key={day.day} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#241A14]">{day.day}</p>
              <button
                type="button"
                onClick={() => props.onSimulateDay(dayIndex)}
                className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                  props.selectedDayIndex === dayIndex
                    ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]'
                    : 'border-[#E8DDD2] bg-white text-[#6B5A50]'
                }`}
              >
                Simular día
              </button>
            </div>

            <div className="space-y-2">
              {MEALS.map((mealType) => {
                const card = day.meals[mealType];
                const locked = props.lockedMeals.includes(mealKey(day.day, mealType));
                const mealIdx = MEALS.indexOf(mealType);
                const cannotMoveDayUp = dayIndex === 0;
                const cannotMoveDayDown = dayIndex === props.days.length - 1;
                const cannotMoveMealUp = mealIdx === 0;
                const cannotMoveMealDown = mealIdx === MEALS.length - 1;
                return (
                  <div
                    key={`${day.day}-${mealType}`}
                    className="rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-[#6B5A50]">{mealType}</p>
                        <p className="text-sm font-semibold text-[#241A14] line-clamp-1">
                          {card.name}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => props.onToggleLock(day.day, mealType)}
                        className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs text-[#6B5A50]"
                      >
                        {locked ? (
                          <Lock size={12} className="inline" />
                        ) : (
                          <Unlock size={12} className="inline" />
                        )}
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                      <button
                        type="button"
                        disabled={locked || cannotMoveDayUp}
                        onClick={() => props.onMoveDay(dayIndex, mealType, -1)}
                        className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 disabled:opacity-40"
                      >
                        <ArrowUp size={12} className="mr-1 inline" /> Día -
                      </button>
                      <button
                        type="button"
                        disabled={locked || cannotMoveDayDown}
                        onClick={() => props.onMoveDay(dayIndex, mealType, 1)}
                        className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 disabled:opacity-40"
                      >
                        <ArrowDown size={12} className="mr-1 inline" /> Día +
                      </button>
                      <button
                        type="button"
                        disabled={locked || cannotMoveMealUp}
                        onClick={() => props.onMoveMealSlot(dayIndex, mealType, -1)}
                        className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 disabled:opacity-40"
                      >
                        <GripVertical size={12} className="mr-1 inline" /> Comida -
                      </button>
                      <button
                        type="button"
                        disabled={locked || cannotMoveMealDown}
                        onClick={() => props.onMoveMealSlot(dayIndex, mealType, 1)}
                        className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 disabled:opacity-40"
                      >
                        <GripVertical size={12} className="mr-1 inline" /> Comida +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
