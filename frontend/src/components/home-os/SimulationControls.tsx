type Props = {
  onReset: () => void;
  onApply: () => void;
  hasChanges: boolean;
};

export function SimulationControls(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Estado temporal de simulación</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Los cambios no se persisten automáticamente.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={props.onReset}
          className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50]"
        >
          Reset simulation
        </button>
        <button
          type="button"
          onClick={props.onApply}
          disabled={!props.hasChanges}
          className="rounded-xl bg-[#C56A1A] px-3 py-2 text-sm font-semibold text-white hover:bg-[#A55412] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aplicar reorganización
        </button>
      </div>
    </article>
  );
}
