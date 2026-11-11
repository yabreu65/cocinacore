type Props = {
  predictions: string[];
};

export function SmartPredictionCard(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">Predicción de faltantes</h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Anticipación diaria basada en simulación temporal del menú.
      </p>
      <ul className="mt-3 space-y-2 text-sm text-bistro-text-secondary">
        {props.predictions.length === 0 ? (
          <li className="rounded-xl border border-bistro-border bg-white/80 px-3 py-2">
            Todavía no hay alertas de faltantes para este menú.
          </li>
        ) : (
          props.predictions.map((prediction) => (
            <li
              key={prediction}
              className="rounded-xl border border-bistro-border bg-white/80 px-3 py-2"
            >
              {prediction}
            </li>
          ))
        )}
      </ul>
    </article>
  );
}
