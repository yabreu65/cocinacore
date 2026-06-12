'use client';

import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
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
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

type OwnerOverview = {
  tenants_total: number;
  users_total: number;
  global_books_total: number;
  global_pdfs_total: number;
  global_chunks_total: number;
  premium_reports_pending: number;
  trials_active: number;
  trials_expired: number;
};

const quickSections = [
  {
    href: '/owner/global-books',
    title: 'Global Books',
    description: 'Catálogo global compartido.',
  },
  {
    href: '/owner/global-pdfs',
    title: 'Global PDFs',
    description: 'Documentos globales del sistema.',
  },
  {
    href: '/owner/indexing',
    title: 'Indexación',
    description: 'Estado y cobertura de chunks/embeddings.',
  },
  {
    href: '/owner/premium-moderation',
    title: 'Moderación Premium',
    description: 'Reportes pendientes y señal comunitaria.',
  },
  { href: '/owner/tenants', title: 'Tenants', description: 'Visión general multi-tenant.' },
  {
    href: '/owner/system-health',
    title: 'System Health',
    description: 'Estado operativo de módulos clave.',
  },
];

function metricCard(label: string, value: number, icon: ReactNode) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/75 p-4 premium-shadow">
      <p className="flex items-center gap-2 text-sm text-[#6B5A50]">
        <span className="inline-flex rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] p-1.5 text-[#A55412]">
          {icon}
        </span>
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-[#241A14]">{value}</p>
    </article>
  );
}

export default function OwnerOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<OwnerOverview>({
    tenants_total: 0,
    users_total: 0,
    global_books_total: 0,
    global_pdfs_total: 0,
    global_chunks_total: 0,
    premium_reports_pending: 0,
    trials_active: 0,
    trials_expired: 0,
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: rpcError } = await supabase.rpc('get_owner_overview_metrics');
        if (rpcError) throw rpcError;

        const payload = data as Partial<OwnerOverview> | null;
        setMetrics({
          tenants_total: payload?.tenants_total ?? 0,
          users_total: payload?.users_total ?? 0,
          global_books_total: payload?.global_books_total ?? 0,
          global_pdfs_total: payload?.global_pdfs_total ?? 0,
          global_chunks_total: payload?.global_chunks_total ?? 0,
          premium_reports_pending: payload?.premium_reports_pending ?? 0,
          trials_active: payload?.trials_active ?? 0,
          trials_expired: payload?.trials_expired ?? 0,
        });
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : 'No se pudo cargar owner overview.'
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
          <Sparkles size={14} /> Control global de plataforma
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Owner Console Overview</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Supervisá catálogos globales, moderación premium, tenants y salud general sin mezclar
          permisos de tenant.
        </p>
      </article>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCard('Tenants totales', metrics.tenants_total, <Building2 size={14} />)}
        {metricCard('Usuarios totales', metrics.users_total, <Users size={14} />)}
        {metricCard('Global books', metrics.global_books_total, <Library size={14} />)}
        {metricCard('Global PDFs', metrics.global_pdfs_total, <FileText size={14} />)}
        {metricCard('Chunks globales', metrics.global_chunks_total, <Database size={14} />)}
        {metricCard(
          'Reports premium pendientes',
          metrics.premium_reports_pending,
          <AlertTriangle size={14} />
        )}
        {metricCard('Trials activos', metrics.trials_active, <Activity size={14} />)}
        {metricCard('Trials vencidos', metrics.trials_expired, <Activity size={14} />)}
      </div>

      <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 premium-shadow">
        <h2 className="text-lg font-semibold">Secciones rápidas</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Navegación owner en modo solo lectura para esta fase.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {quickSections.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              className="rounded-xl border border-[#E8DDD2] bg-white/70 p-3 transition hover:border-[#C56A1A]/35"
            >
              <p className="font-semibold text-[#241A14]">{section.title}</p>
              <p className="mt-1 text-sm text-[#6B5A50]">{section.description}</p>
            </Link>
          ))}
        </div>
      </article>

      {loading ? <p className="text-sm text-[#6B5A50]">Cargando métricas owner...</p> : null}
    </section>
  );
}
