type Props = {
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
};

export function IngredientConstraintCard(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Bloqueo de ingredientes críticos</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">
        Marcá ingredientes que querés ahorrar en la simulación.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {props.options.slice(0, 10).map((value) => {
          const active = props.selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => props.onToggle(value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                active
                  ? 'border-[#A55412] bg-[#C56A1A]/10 text-[#A55412]'
                  : 'border-[#E8DDD2] bg-white text-[#6B5A50]'
              }`}
            >
              {active ? '🔒 ' : ''}
              {value}
            </button>
          );
        })}
      </div>
    </article>
  );
}
