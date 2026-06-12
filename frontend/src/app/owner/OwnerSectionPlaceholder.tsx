type OwnerSectionPlaceholderProps = {
  title: string;
  description: string;
};

export default function OwnerSectionPlaceholder({
  title,
  description,
}: OwnerSectionPlaceholderProps) {
  return (
    <section className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
      <h2 className="text-2xl font-semibold text-[#241A14]">{title}</h2>
      <p className="mt-2 text-sm text-[#6B5A50]">{description}</p>
      <p className="mt-4 rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2 text-xs text-[#6B5A50]">
        Fase actual: solo lectura. Acciones de creación/edición llegan en la siguiente fase.
      </p>
    </section>
  );
}
