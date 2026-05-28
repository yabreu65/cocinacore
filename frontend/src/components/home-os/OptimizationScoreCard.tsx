import type { MealPlanOptimizationScore } from '@/lib/inventory/meal-plan-optimizer';

type Props = {
  score: MealPlanOptimizationScore;
};

type ScoreRow = { key: keyof MealPlanOptimizationScore; label: string };

const SCORE_ROWS: ScoreRow[] = [
  { key: 'cost', label: 'Costo' },
  { key: 'waste', label: 'Desperdicio' },
  { key: 'freshness', label: 'Frescura' },
  { key: 'reuse', label: 'Reutilización' },
  { key: 'balance', label: 'Balance' },
  { key: 'missing', label: 'Faltantes' },
];

function scoreTone(value: number): string {
  if (value >= 85) return 'text-[#567A3B]';
  if (value >= 70) return 'text-[#A55412]';
  return 'text-[#B84D4D]';
}

export function OptimizationScoreCard({ score }: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold">Estado operativo del menú</h3>
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-2">
        <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#6D4AFF]/40 bg-white text-lg font-bold text-[#241A14]">
          {score.total}
        </div>
        <div>
          <p className="text-sm font-semibold text-[#241A14]">Eficiencia culinaria</p>
          <p className="text-xs text-[#6B5A50]">Score total sobre 100</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SCORE_ROWS.map((row) => (
          <div key={row.key} className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2">
            <p className="text-xs text-[#6B5A50]">{row.label}</p>
            <p className={`text-base font-semibold ${scoreTone(score[row.key])}`}>{score[row.key]}/100</p>
          </div>
        ))}
      </div>
    </article>
  );
}
