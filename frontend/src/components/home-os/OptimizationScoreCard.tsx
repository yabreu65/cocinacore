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
  if (value >= 85) return 'text-bistro-action-secondary';
  if (value >= 70) return 'text-bistro-action-primary';
  return 'text-bistro-danger';
}

export function OptimizationScoreCard({ score }: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold">Estado operativo del menú</h3>
      <div className="mt-3 flex items-center gap-3 rounded-xl border border-bistro-border bg-bistro-page px-3 py-2">
        <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-bistro-action-secondary/40 bg-white text-lg font-bold text-bistro-text-primary">
          {score.total}
        </div>
        <div>
          <p className="text-sm font-semibold text-bistro-text-primary">Eficiencia culinaria</p>
          <p className="text-xs text-bistro-text-secondary">Score total sobre 100</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SCORE_ROWS.map((row) => (
          <div key={row.key} className="rounded-xl border border-bistro-border bg-white px-3 py-2">
            <p className="text-xs text-bistro-text-secondary">{row.label}</p>
            <p className={`text-base font-semibold ${scoreTone(score[row.key])}`}>
              {score[row.key]}/100
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}
