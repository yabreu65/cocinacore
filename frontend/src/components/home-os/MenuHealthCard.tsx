type Props = {
  coveredMessage: string;
  lowIngredientsCount: number;
  shoppingItemsCount: number;
  estimatedCost: number;
  onViewDetails: () => void;
};

export function MenuHealthCard(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Estado del menú</h3>
      <div className="mt-2 space-y-1.5 text-sm text-[#6B5A50]">
        <p>✅ {props.coveredMessage}</p>
        <p>⚠️ {props.lowIngredientsCount} ingredientes quedarán bajos esta semana.</p>
        <p>🛒 Necesitás comprar {props.shoppingItemsCount} productos.</p>
        <p>💰 Costo estimado de reposición: ${props.estimatedCost.toFixed(2)}.</p>
      </div>
      <button
        type="button"
        onClick={props.onViewDetails}
        className="mt-3 rounded-lg border border-[#E8DDD2] bg-white px-3 py-1.5 text-sm font-semibold text-[#241A14] hover:border-[#C56A1A]/40"
      >
        Ver detalles
      </button>
    </article>
  );
}
