import Link from 'next/link';

type LoadErrorNoticeProps = {
  message: string;
  onRetry?: () => void;
};

export default function LoadErrorNotice({ message, onRetry }: LoadErrorNoticeProps) {
  return (
    <section
      role="alert"
      className="mb-4 rounded-2xl border border-bistro-danger/30 bg-white p-5 shadow-sm"
    >
      <p className="font-bistro-heading text-xl font-semibold text-bistro-text-primary">
        No pudimos cargar tu menú
      </p>
      <p className="mt-2 text-sm leading-relaxed text-bistro-text-secondary">{message}</p>
      <p className="mt-2 text-xs text-bistro-text-secondary">
        Reintentar la consulta no genera otro menú ni descuenta ingredientes del inventario.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center rounded-xl bg-bistro-action-primary px-5 text-sm font-semibold text-white hover:opacity-90"
          >
            Reintentar carga
          </button>
        ) : null}
        <Link
          href="/app"
          className="inline-flex min-h-11 items-center rounded-xl border border-bistro-border px-5 text-sm font-semibold text-bistro-text-primary hover:bg-bistro-page"
        >
          Volver al Inicio
        </Link>
      </div>
    </section>
  );
}
