import Link from 'next/link';
import { ArrowLeft, Clock3, LockKeyhole } from 'lucide-react';

type OwnerSectionPlaceholderProps = {
  title: string;
  description: string;
};

export default function OwnerSectionPlaceholder({
  title,
  description,
}: OwnerSectionPlaceholderProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-5">
      <article className="min-w-0 overflow-hidden rounded-[26px] bg-white p-6 shadow-sm sm:p-9">
        <p className="inline-flex items-center gap-2 rounded-full bg-bistro-page px-3 py-1.5 text-xs font-bold text-bistro-action-secondary">
          <Clock3 size={15} aria-hidden="true" /> Funcionalidad prevista
        </p>
        <h2 className="mt-7 font-bistro-heading text-3xl font-semibold text-bistro-text-primary sm:text-4xl">
          {title}
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-bistro-text-secondary">
          {description}
        </p>
        <div
          role="status"
          className="mt-8 rounded-2xl border border-bistro-border bg-bistro-surface-warm px-5 py-5"
        >
          <p className="font-semibold text-bistro-text-primary">Todavía no está disponible</p>
          <p className="mt-2 text-sm leading-relaxed text-bistro-text-secondary">
            Módulo pendiente de implementación. Esta pantalla todavía no ofrece funciones de
            gestión. No se muestran controles que aparenten guardar, publicar o modificar datos.
          </p>
        </div>
        <Link
          href="/owner"
          className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-xl bg-bistro-action-primary px-5 text-sm font-semibold text-white hover:opacity-90"
        >
          <ArrowLeft size={16} aria-hidden="true" /> Volver al resumen
        </Link>
      </article>
      <aside className="flex min-h-52 flex-col justify-between rounded-[26px] bg-bistro-inverse p-7 text-white">
        <LockKeyhole size={34} className="text-bistro-champagne" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-bistro-champagne">
            Acceso protegido
          </p>
          <p className="mt-2 font-bistro-heading text-xl font-semibold">Sin acciones disponibles</p>
          <p className="mt-2 text-sm text-bistro-cream">
            El módulo es informativo hasta que se habilite su gestión.
          </p>
        </div>
      </aside>
    </section>
  );
}
