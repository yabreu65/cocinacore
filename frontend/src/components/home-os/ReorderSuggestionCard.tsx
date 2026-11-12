type Props = {
  suggestions: string[];
};

export function ReorderSuggestionCard(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">
        Sugerencias IA de reordenamiento
      </h3>
      <ul className="mt-3 space-y-2 text-sm text-bistro-text-secondary">
        {props.suggestions.length === 0 ? (
          <li className="rounded-xl border border-bistro-border bg-white/80 px-3 py-2">
            Aún no hay sugerencias para este estado de simulación.
          </li>
        ) : (
          props.suggestions.map((item) => (
            <li key={item} className="rounded-xl border border-bistro-border bg-white/80 px-3 py-2">
              {item}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
