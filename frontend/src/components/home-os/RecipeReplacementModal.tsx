import { X } from 'lucide-react';
import { RecipeAlternativeCard } from './RecipeAlternativeCard';

type RecipeAlternative = {
  id: string;
  title: string;
  description: string;
  reasons: string[];
};

type Props = {
  open: boolean;
  day: string;
  mealType: string;
  alternatives: RecipeAlternative[];
  onClose: () => void;
  onSelectAlternative: (alternativeId: string) => void;
  onRegenerateMeal: () => void;
};

export function RecipeReplacementModal(props: Props) {
  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-[#16110D]/35 p-3 sm:p-6">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#E8DDD2] bg-[#FAF6F1]">
        <div className="flex items-center justify-between border-b border-[#E8DDD2] px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-[#241A14]">Cambiar receta inteligentemente</p>
            <p className="text-xs text-[#6B5A50]">
              {props.day} · {props.mealType}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-[#E8DDD2] bg-white p-2 text-[#6B5A50] hover:border-[#C56A1A]/40"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {props.alternatives.map((alternative) => (
              <RecipeAlternativeCard
                key={alternative.id}
                title={alternative.title}
                description={alternative.description}
                reasons={alternative.reasons}
                onSelect={() => props.onSelectAlternative(alternative.id)}
              />
            ))}
          </div>
        </div>

        <div className="border-t border-[#E8DDD2] px-4 py-3">
          <button
            type="button"
            onClick={props.onRegenerateMeal}
            className="rounded-lg bg-[#C56A1A] px-3 py-2 text-sm font-semibold text-white hover:bg-[#A55412]"
          >
            Regenerar comida
          </button>
        </div>
      </div>
    </div>
  );
}
