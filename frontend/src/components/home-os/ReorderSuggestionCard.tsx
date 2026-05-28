type Props = {
  suggestions: string[];
};

export function ReorderSuggestionCard(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Sugerencias IA de reordenamiento</h3>
      <ul className="mt-3 space-y-2 text-sm text-[#6B5A50]">
        {props.suggestions.length === 0 ? (
          <li className="rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2">Aún no hay sugerencias para este estado de simulación.</li>
        ) : (
          props.suggestions.map((item) => (
            <li key={item} className="rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2">
              {item}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
