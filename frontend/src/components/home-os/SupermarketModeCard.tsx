type Props = {
  estimatedCost: number;
  missingCount: number;
  reusedCount: number;
  reviewCount: number;
};

export function SupermarketModeCard(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-gradient-to-br from-white to-[#FAF6F1] p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Modo supermercado</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">
        Compra semanal estimada para ejecutar tu menú sin fricción.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Costo estimado" value={`$${props.estimatedCost.toFixed(2)}`} />
        <Metric label="Faltantes" value={String(props.missingCount)} />
        <Metric label="Reutilizados" value={String(props.reusedCount)} />
        <Metric label="Revisar" value={String(props.reviewCount)} />
      </div>
    </article>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E8DDD2] bg-white/85 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[#6B5A50]">{props.label}</p>
      <p className="mt-1 text-lg font-semibold text-[#241A14]">{props.value}</p>
    </div>
  );
}
