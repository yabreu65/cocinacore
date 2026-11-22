import {
  Activity,
  AlertTriangle,
  Building2,
  Database,
  FileText,
  Library,
  Sparkles,
  Users,
  ArrowUpRight,
  Upload,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { getOwnerMetrics, type OwnerMetrics } from '@/lib/owner/metrics';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

export const dynamic = 'force-dynamic';

function metricCard(label: string, value: number | null, icon: React.ReactNode) {
  return (
    <article className="flex min-w-0 flex-col justify-between rounded-2xl border border-bistro-border/70 bg-white px-4 py-4 shadow-sm sm:px-5">
      <p className="flex items-center gap-2 text-xs font-medium leading-snug text-bistro-text-secondary sm:text-sm">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-bistro-page text-bistro-action-secondary">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-4 font-bistro-heading text-3xl font-bold leading-none tracking-tight text-bistro-text-primary">
        {value ?? '—'}
      </p>
    </article>
  );
}

export default async function OwnerOverviewPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  if (!(await isPlatformOwner(user))) {
    redirect('/app');
  }

  let metrics: OwnerMetrics | null = null;
  try {
    metrics = await getOwnerMetrics();
  } catch {
    // The protected metrics service fails closed. Do not retry with another
    // connection or fabricate zero counts; only the metrics are unavailable.
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,1fr)]">
        <article className="relative overflow-hidden rounded-[26px] border border-bistro-border bg-white px-6 py-7 shadow-sm sm:px-8">
          <div
            className="absolute -right-12 -top-12 size-40 rounded-full bg-bistro-action-secondary/10"
            aria-hidden="true"
          />
          <p className="relative inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-bistro-action-secondary">
            <Sparkles size={16} aria-hidden="true" /> Vista general
          </p>
          <h2 className="relative mt-3 font-bistro-heading text-3xl font-semibold leading-tight text-bistro-text-primary sm:text-4xl">
            Panel de administración
          </h2>
          <p className="relative mt-3 max-w-lg text-sm leading-relaxed text-bistro-text-secondary sm:text-base">
            La biblioteca y los indicadores de CocinaCore, en un mismo lugar.
          </p>
          <div className="relative mt-6 flex flex-wrap gap-3">
            <Link
              href="/owner/global-pdfs/upload"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bistro-action-primary px-5 text-sm font-semibold text-white hover:opacity-90"
            >
              <Upload size={17} aria-hidden="true" /> Cargar PDF
            </Link>
            <Link
              href="/owner/global-books"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-bistro-border bg-white px-4 text-sm font-semibold text-bistro-text-primary hover:bg-bistro-page"
            >
              Ver libros <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </article>
        <article className="hidden flex-col justify-between rounded-[26px] bg-bistro-inverse p-6 text-white sm:p-7 xl:flex">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-white/10 text-bistro-champagne">
            <ShieldCheck size={24} aria-hidden="true" />
          </div>
          <div className="mt-6">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-bistro-champagne">
              Operación
            </p>
            <h3 className="mt-2 font-bistro-heading text-2xl font-semibold">Estado de servicios</h3>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
              Consultá los resultados reales de PostgreSQL, Redis, Gemini y almacenamiento.
            </p>
            <Link
              href="/owner/system-health"
              className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-bistro-champagne hover:text-white"
            >
              Ver estado del sistema <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </article>
      </div>

      {!metrics ? (
        <article
          role="alert"
          className="rounded-2xl border border-bistro-warning/30 bg-bistro-warning/10 p-4"
        >
          <p className="font-semibold text-bistro-warning">Métricas temporalmente no disponibles</p>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            No pudimos obtener los recuentos. Puedes continuar usando las demás secciones del panel.
          </p>
          <form action="/owner" method="get" className="mt-2">
            <button type="submit" className="text-sm font-semibold underline">
              Reintentar métricas
            </button>
          </form>
        </article>
      ) : null}

      <section aria-labelledby="owner-metrics">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h3 id="owner-metrics" className="font-bistro-heading text-xl font-semibold">
            Indicadores de plataforma
          </h3>
          <p className="text-xs text-bistro-text-secondary">
            Recuentos disponibles · no estimaciones
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {metricCard('Hogares registrados', metrics?.tenants ?? null, <Building2 size={17} />)}
          {metricCard('Usuarios registrados', metrics?.users ?? null, <Users size={17} />)}
          {metricCard('Libros globales', metrics?.books ?? null, <Library size={17} />)}
          {metricCard('Documentos PDF', metrics?.pdfs ?? null, <FileText size={17} />)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metricCard('Fragmentos indexados', metrics?.chunks ?? null, <Database size={17} />)}
          {metricCard('Reportes premium', metrics?.reports ?? null, <AlertTriangle size={17} />)}
          {metricCard(
            'Administradores registrados',
            metrics?.owners ?? null,
            <Activity size={17} />
          )}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(230px,1fr)]">
        <section
          aria-labelledby="owner-tools"
          className="rounded-[26px] border border-bistro-border bg-white p-5 shadow-sm sm:p-6"
        >
          <h3 id="owner-tools" className="font-bistro-heading text-xl font-semibold">
            Biblioteca y sistema
          </h3>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            Accesos a las herramientas disponibles.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              {
                href: '/owner/global-books',
                title: 'Biblioteca global',
                description: 'Catálogo de libros compartidos.',
                icon: <Library size={19} />,
              },
              {
                href: '/owner/global-pdfs',
                title: 'Documentos PDF',
                description: 'Documentos de la biblioteca.',
                icon: <FileText size={19} />,
              },
              {
                href: '/owner/global-pdfs/upload',
                title: 'Cargar PDF',
                description: 'Agregar un documento al catálogo.',
                icon: <Upload size={19} />,
              },
              {
                href: '/owner/system-health',
                title: 'Estado del sistema',
                description: 'Consultar dependencias y servicios.',
                icon: <Activity size={19} />,
              },
            ].map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="group flex min-h-20 items-center gap-3 rounded-2xl border border-bistro-border/80 bg-bistro-page/50 p-3.5 transition-colors hover:border-bistro-action-secondary hover:bg-bistro-page focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bistro-action-primary"
              >
                <span
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-bistro-action-secondary"
                  aria-hidden="true"
                >
                  {section.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-bistro-text-primary">
                    {section.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-bistro-text-secondary">
                    {section.description}
                  </span>
                </span>
                <ArrowUpRight
                  size={17}
                  className="shrink-0 text-bistro-text-secondary group-hover:text-bistro-action-secondary"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </div>
        </section>
        <aside className="rounded-[26px] border border-bistro-border bg-bistro-surface-warm p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-bistro-text-secondary">
            Próximas herramientas
          </p>
          <h3 className="mt-2 font-bistro-heading text-xl font-semibold">Módulos pendientes</h3>
          <p className="mt-2 text-sm leading-relaxed text-bistro-text-secondary">
            La gestión de hogares, la consola de indexación y la moderación Premium aún no están
            disponibles como herramientas administrativas completas.
          </p>
          <div className="mt-5 space-y-3 border-t border-bistro-border pt-4 text-sm text-bistro-text-secondary">
            <p>
              Indexación <span className="float-right text-xs">Pendiente</span>
            </p>
            <p>
              Moderación Premium <span className="float-right text-xs">Pendiente</span>
            </p>
            <p>
              Hogares <span className="float-right text-xs">Pendiente</span>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
