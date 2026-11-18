type OwnerSectionPlaceholderProps = {
  title: string;
  description: string;
};

export default function OwnerSectionPlaceholder({
  title,
  description,
}: OwnerSectionPlaceholderProps) {
  return (
    <section className="rounded-2xl border border-bistro-border bg-white/80 p-5 premium-shadow">
      <h2 className="text-2xl font-semibold text-bistro-text-primary">{title}</h2>
      <p className="mt-2 text-sm text-bistro-text-secondary">{description}</p>
      <p className="mt-4 rounded-xl border border-bistro-border bg-white/70 px-3 py-2 text-xs text-bistro-text-secondary">
        Módulo pendiente de implementación. Esta pantalla todavía no ofrece funciones de gestión.
      </p>
    </section>
  );
}
