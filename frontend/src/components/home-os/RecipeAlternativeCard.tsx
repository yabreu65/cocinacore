type Props = {
  title: string;
  description: string;
  reasons: string[];
  onSelect: () => void;
};

export function RecipeAlternativeCard(props: Props) {
  return (
    <article className="rounded-xl border border-bistro-border bg-white/90 p-3">
      <h4 className="text-sm font-semibold text-bistro-text-primary">{props.title}</h4>
      <p className="mt-1 text-xs text-bistro-text-secondary">{props.description}</p>
      <ul className="mt-2 space-y-1 text-xs text-bistro-action-secondary">
        {props.reasons.map((reason) => (
          <li key={reason}>✓ {reason}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={props.onSelect}
        className="mt-3 rounded-lg border border-bistro-border bg-white px-3 py-1.5 text-xs font-semibold text-bistro-text-primary hover:border-bistro-action-primary/40"
      >
        Usar esta receta
      </button>
    </article>
  );
}
