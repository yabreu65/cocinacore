type Props = {
  title: string;
  description: string;
  reasons: string[];
  onSelect: () => void;
};

export function RecipeAlternativeCard(props: Props) {
  return (
    <article className="rounded-xl border border-[#E8DDD2] bg-white/90 p-3">
      <h4 className="text-sm font-semibold text-[#241A14]">{props.title}</h4>
      <p className="mt-1 text-xs text-[#6B5A50]">{props.description}</p>
      <ul className="mt-2 space-y-1 text-xs text-[#567A3B]">
        {props.reasons.map((reason) => (
          <li key={reason}>✓ {reason}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={props.onSelect}
        className="mt-3 rounded-lg border border-[#E8DDD2] bg-white px-3 py-1.5 text-xs font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
      >
        Usar esta receta
      </button>
    </article>
  );
}
