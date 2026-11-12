import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function AdvancedTimelineSection(props: Props) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/85 p-3 sm:p-4 xl:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-bistro-text-primary">⚙️ Modo avanzado</h3>
          <p className="text-sm text-bistro-text-secondary">
            Personalización manual del calendario (opcional).
          </p>
        </div>
        <button
          type="button"
          onClick={props.onToggle}
          className="rounded-lg border border-bistro-border bg-white px-3 py-1.5 text-xs font-semibold text-bistro-text-primary hover:border-bistro-action-primary/40"
        >
          {props.open ? 'Ocultar timeline avanzado' : 'Abrir timeline avanzado'}
        </button>
      </div>
      {props.open ? <div className="mt-3">{props.children}</div> : null}
    </article>
  );
}
