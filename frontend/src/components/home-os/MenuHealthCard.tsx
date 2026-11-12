type Props = {
  coveredMessage: string;
  lowIngredientsCount: number;
  shoppingItemsCount: number;
  estimatedCost: number;
  onViewDetails: () => void;
};

export function MenuHealthCard(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">Estado del menú</h3>
      <div className="mt-2 space-y-1.5 text-sm text-bistro-text-secondary">
        <p>✅ {props.coveredMessage}</p>
        <p>⚠️ {props.lowIngredientsCount} ingredientes quedarán bajos esta semana.</p>
        <p>🛒 Necesitás comprar {props.shoppingItemsCount} productos.</p>
        <p>💰 Costo estimado de reposición: ${props.estimatedCost.toFixed(2)}.</p>
      </div>
      <button
        type="button"
        onClick={props.onViewDetails}
        className="mt-3 rounded-lg border border-bistro-border bg-white px-3 py-1.5 text-sm font-semibold text-bistro-text-primary hover:border-bistro-action-primary/40"
      >
        Ver detalles
      </button>
    </article>
  );
}
