'use client';

import { useEffect, useRef } from 'react';
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!props.open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement;
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Cambiar receta del menú"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      className="fixed inset-0 z-[90] m-auto h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-3xl overflow-hidden border-0 bg-transparent p-0 text-bistro-text-primary backdrop:bg-bistro-inverse/35 sm:h-[calc(100dvh-3rem)]"
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-bistro-border bg-bistro-page">
        <div className="flex items-center justify-between border-b border-bistro-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-bistro-text-primary">
              Cambiar receta inteligentemente
            </p>
            <p className="text-xs text-bistro-text-secondary">
              {props.day} · {props.mealType}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar cambio de receta"
            ref={closeButtonRef}
            onClick={props.onClose}
            className="rounded-lg border border-bistro-border bg-white p-2 text-bistro-text-secondary hover:border-bistro-action-primary/40"
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

        <div className="border-t border-bistro-border px-4 py-3">
          <button
            type="button"
            onClick={props.onRegenerateMeal}
            className="rounded-lg bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white hover:bg-bistro-action-primary"
          >
            Regenerar comida
          </button>
        </div>
      </div>
    </dialog>
  );
}
