import {
  Activity,
  AlertTriangle,
  Building2,
  Database,
  FileText,
  Library,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { getOwnerMetrics, type OwnerMetrics } from '@/lib/owner/metrics';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

export const dynamic = 'force-dynamic';

function metricCard(label: string, value: number | null, icon: React.ReactNode) {
  return (
    <article className="rounded-2xl border border-bistro-border bg-white/75 p-4 premium-shadow">
      <p className="flex items-center gap-2 text-sm text-bistro-text-secondary">
        <span className="inline-flex rounded-lg border border-bistro-border bg-bistro-page p-1.5 text-bistro-action-primary">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-bistro-text-primary">{value ?? '—'}</p>
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
    <section className="space-y-4">
      <article className="rounded-3xl border border-bistro-border bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-bistro-action-secondary/25 bg-bistro-action-secondary/10 px-3 py-1 text-xs font-semibold text-bistro-action-secondary">
          <Sparkles size={14} /> Control global de plataforma
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-bistro-text-primary">
          Panel de administración
        </h2>
        <p className="mt-1 text-sm text-bistro-text-secondary">
          Consulta el estado de CocinaCore y administra la biblioteca culinaria compartida desde un solo lugar.
        </p>
      </article>

      {!metrics ? (
        <article role="alert" className="rounded-2xl border border-bistro-warning/30 bg-bistro-warning/10 p-4">
          <p className="font-semibold text-bistro-warning">Métricas temporalmente no disponibles</p>
          <p className="mt-1 text-sm text-bistro-text-secondary">
            No pudimos obtener los recuentos. Puedes continuar usando las demás secciones del panel.
          </p>
          <form action="/owner" method="get" className="mt-2">
            <button type="submit" className="text-sm font-semibold underline">Reintentar métricas</button>
          </form>
        </article>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCard('Hogares registrados', metrics?.tenants ?? null, <Building2 size={14} />)}
        {metricCard('Usuarios registrados', metrics?.users ?? null, <Users size={14} />)}
        {metricCard('Libros globales', metrics?.books ?? null, <Library size={14} />)}
        {metricCard('Documentos PDF', metrics?.pdfs ?? null, <FileText size={14} />)}
        {metricCard('Fragmentos indexados', metrics?.chunks ?? null, <Database size={14} />)}
        {metricCard('Reportes premium', metrics?.reports ?? null, <AlertTriangle size={14} />)}
        {metricCard('Administradores registrados', metrics?.owners ?? null, <Activity size={14} />)}
      </div>

      <article className="rounded-2xl border border-bistro-border bg-white/80 p-4 premium-shadow">
        <h2 className="text-lg font-semibold">Biblioteca y sistema</h2>
        <p className="mt-1 text-sm text-bistro-text-secondary">
          Accede a las herramientas disponibles de la biblioteca global y al estado del sistema.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            {
              href: '/owner/global-books',
              title: 'Biblioteca global',
              description: 'Consulta el catálogo de libros culinarios compartidos.',
            },
            {
              href: '/owner/global-pdfs',
              title: 'Documentos PDF',
              description: 'Consulta los documentos del recetario global.',
            },
            {
              href: '/owner/global-pdfs/upload',
              title: 'Cargar PDF',
              description: 'Abre la herramienta de carga de documentos.',
            },
            {
              href: '/owner/system-health',
              title: 'Estado del sistema',
              description: 'Consulta la salud de los servicios.',
            },
          ].map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="rounded-xl border border-bistro-border bg-white/70 p-3 transition hover:border-bistro-action-primary/35"
            >
              <p className="font-semibold text-bistro-text-primary">{section.title}</p>
              <p className="mt-1 text-sm text-bistro-text-secondary">{section.description}</p>
            </Link>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-bistro-border bg-white/80 p-4 premium-shadow">
        <h2 className="text-lg font-semibold">Módulos pendientes</h2>
        <p className="mt-1 text-sm text-bistro-text-secondary">
          La gestión de hogares, la consola de indexación y la moderación Premium aún no
          están disponibles como herramientas administrativas completas.
        </p>
      </article>
    </section>
  );
}
