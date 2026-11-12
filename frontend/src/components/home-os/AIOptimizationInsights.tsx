type Props = {
  notes: string[];
};

export function AIOptimizationInsights({ notes }: Props) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold">Explicabilidad IA</h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Qué cambió y por qué conviene en esta simulación.
      </p>
      <ul className="mt-3 space-y-2">
        {notes.map((note) => (
          <li
            key={note}
            className="rounded-xl border border-bistro-border bg-bistro-page px-3 py-2 text-sm text-bistro-text-primary break-words"
          >
            {note}
          </li>
        ))}
      </ul>
    </article>
  );
}
