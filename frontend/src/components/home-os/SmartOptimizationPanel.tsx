import type { OptimizationMode } from '@/lib/meal-planner/simulation-state';


type Props = {
  activeMode: OptimizationMode | null;
  onOptimize: (mode: OptimizationMode) => void;
};

const OPTIONS: Array<{ mode: OptimizationMode; label: string }> = [
  { mode: 'reduce_waste', label: 'Optimizar desperdicio' },
  { mode: 'optimize_cost', label: 'Optimizar costo' },
  { mode: 'prioritize_fresh', label: 'Priorizar frescos' },
  { mode: 'reduce_missing', label: 'Reducir faltantes' },
  { mode: 'reuse_proteins', label: 'Reutilizar proteínas' },
  { mode: 'balance_ingredients', label: 'Balancear ingredientes' },
];

export function SmartOptimizationPanel(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Modo optimización</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Reordena temporalmente el menú con foco operativo.</p>
      {props.activeMode ? (
        <p className="mt-2 rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] px-2 py-1 text-xs font-semibold text-[#6B5A50]">
          Optimización activa: {OPTIONS.find((option) => option.mode === props.activeMode)?.label ?? props.activeMode}
        </p>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            onClick={() => props.onOptimize(option.mode)}
            className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
              props.activeMode === option.mode
                ? 'border-[#16110D] bg-[#16110D] text-[#F5ECE2]'
                : 'border-[#E8DDD2] bg-white text-[#6B5A50]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </article>
  );
}
