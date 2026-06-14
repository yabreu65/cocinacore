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
import { query } from '@/lib/db';
import { isPlatformOwner } from '@/lib/db/repositories/platformOwnerRepository';

export const dynamic = 'force-dynamic';

type CountRow = { count: string };

function metricCard(label: string, value: number, icon: React.ReactNode) {
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

export default async function OwnerOverviewPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  if (!(await isPlatformOwner(user.id))) {
    redirect('/app');
  }

  const [tenants, users, books, pdfs, chunks, reports, owners] = await Promise.all([
    query<CountRow>('select count(*)::text as count from public.tenants'),
    query<CountRow>('select count(*)::text as count from public.users'),
    query<CountRow>('select count(*)::text as count from public.global_books'),
    query<CountRow>('select count(*)::text as count from public.global_pdf_library'),
    query<CountRow>('select count(*)::text as count from public.book_chunks where global_book_id is not null'),
    query<CountRow>('select count(*)::text as count from public.premium_review_reports'),
    query<CountRow>('select count(*)::text as count from public.platform_owners'),
  ]);

  const toNumber = (value: string | undefined): number => Number(value ?? '0');

  return (
    <section className="space-y-4">
      <article className="rounded-3xl border border-[#E8DDD2] bg-white/90 p-5 premium-shadow">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#6D4AFF]/25 bg-[#6D4AFF]/10 px-3 py-1 text-xs font-semibold text-[#5A3EE6]">
          <Sparkles size={14} /> Control global de plataforma
        </p>
        <h2 className="mt-3 text-2xl font-semibold text-[#241A14]">Owner Console Overview</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Resumen mínimo ya desacoplado del backend anterior para continuar la migración.
        </p>
      </article>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCard('Tenants totales', toNumber(tenants.rows[0]?.count), <Building2 size={14} />)}
        {metricCard('Usuarios totales', toNumber(users.rows[0]?.count), <Users size={14} />)}
        {metricCard('Global books', toNumber(books.rows[0]?.count), <Library size={14} />)}
        {metricCard('Global PDFs', toNumber(pdfs.rows[0]?.count), <FileText size={14} />)}
        {metricCard('Chunks globales', toNumber(chunks.rows[0]?.count), <Database size={14} />)}
        {metricCard('Reports premium', toNumber(reports.rows[0]?.count), <AlertTriangle size={14} />)}
        {metricCard('Owners registrados', toNumber(owners.rows[0]?.count), <Activity size={14} />)}
      </div>

      <article className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4 premium-shadow">
        <h2 className="text-lg font-semibold">Secciones rápidas</h2>
        <p className="mt-1 text-sm text-[#6B5A50]">
          Varias acciones siguen en reconstrucción, pero las vistas ya compilan sobre PostgreSQL directo.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            { href: '/owner/global-books', title: 'Global Books', description: 'Catálogo global compartido.' },
            { href: '/owner/global-pdfs', title: 'Global PDFs', description: 'Documentos globales del sistema.' },
            { href: '/owner/indexing', title: 'Indexación', description: 'Estado y cobertura de chunks.' },
            { href: '/owner/premium-moderation', title: 'Moderación Premium', description: 'Revisión de reportes.' },
            { href: '/owner/tenants', title: 'Tenants', description: 'Visión general multi-tenant.' },
            { href: '/owner/system-health', title: 'System Health', description: 'Salud operativa.' },
          ].map((section) => (
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
    </section>
  );
}
