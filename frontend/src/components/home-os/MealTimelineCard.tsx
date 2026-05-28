type DayTimeline = {
  day: string;
  meals: Array<{ label: string; title: string }>;
};

type Props = {
  timeline: DayTimeline[];
  selectedDayIndex: number;
  onSimulateDay: (index: number) => void;
};

const MEAL_EMOJI: Record<string, string> = {
  Desayuno: '🍳',
  Almuerzo: '🍛',
  Cena: '🥗',
};

export function MealTimelineCard(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Timeline culinario visual</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Cómo fluye tu menú durante el período seleccionado.</p>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {props.timeline.map((day, dayIndex) => (
          <section key={day.day} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
            <div className="flex items-center justify-between gap-2">
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
            <ul className="mt-2 space-y-1.5">
              {day.meals.map((meal) => (
                <li key={`${day.day}-${meal.label}`} className="rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] px-2.5 py-1.5 text-sm text-[#6B5A50]">
                  <span className="font-semibold text-[#241A14]">{MEAL_EMOJI[meal.label] ?? '🍽️'} {meal.label}</span>
                  <p className="line-clamp-1">{meal.title}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
