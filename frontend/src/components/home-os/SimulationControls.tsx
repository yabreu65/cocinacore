type Props = {
  onReset: () => void;
  onApply: () => void;
  hasChanges: boolean;
};

export function SimulationControls(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-bistro-text-primary">
        Estado temporal de simulación
      </h3>
      <p className="mt-1 text-sm text-bistro-text-secondary">
        Los cambios no se persisten automáticamente.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={props.onReset}
          className="rounded-xl border border-bistro-border bg-white px-3 py-2 text-sm font-semibold text-bistro-text-secondary"
        >
          Reset simulation
        </button>
        <button
          type="button"
          onClick={props.onApply}
          disabled={!props.hasChanges}
          className="rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white hover:bg-bistro-action-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aplicar reorganización
        </button>
      </div>
    </article>
  );
}
