type Props = {
  weeklyCoverage: number;
  criticalCount: number;
  reusedCount: number;
  projectedCost: number;
  criticalIngredients: string[];
  reusedIngredients: string[];
};

export function HomeIntelligenceDashboard(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">
        Home Intelligence Dashboard
      </h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Visión operativa de tu cocina para esta planificación.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="Cobertura semanal" value={`${props.weeklyCoverage}%`} />
        <Metric label="Críticos" value={String(props.criticalCount)} />
        <Metric label="Reutilizados" value={String(props.reusedCount)} />
        <Metric label="Costo proyectado" value={`$${props.projectedCost.toFixed(2)}`} />
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <InfoList
          title="Próximos a agotarse"
          items={props.criticalIngredients}
          empty="Sin alertas críticas"
        />
        <InfoList
          title="Más reutilizados"
          items={props.reusedIngredients}
          empty="Sin reutilización detectada"
        />
      </div>
    </article>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-bistro-border bg-white/80 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.08em] text-bistro-text-secondary">
        {props.label}
      </p>
      <p className="mt-1 text-lg font-semibold text-bistro-text-primary">{props.value}</p>
    </div>
  );
}

function InfoList(props: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-xl border border-bistro-border bg-white/80 p-3">
      <p className="text-sm font-semibold text-bistro-text-primary">{props.title}</p>
      <ul className="mt-2 space-y-1 text-sm text-bistro-text-secondary">
        {props.items.length === 0 ? (
          <li>{props.empty}</li>
        ) : (
          props.items.map((item) => <li key={`${props.title}-${item}`}>• {item}</li>)
        )}
      </ul>
    </section>
  );
}
