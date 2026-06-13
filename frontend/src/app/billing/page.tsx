import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
import type { TenantType } from '@/lib/auth/types';

export const dynamic = 'force-dynamic';

type TenantSummaryRow = {
  trial_ends_at: string | null;
  tenant_type: TenantType;
};

type CountRow = { count: string };

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
}

export default async function BillingPage() {
  const user = await getCurrentUser();

  if (!user?.tenant) {
    return (
      <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
        <section className="mx-auto w-full max-w-3xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Facturación</h1>
          <p className="mt-2 text-[#6B5A50]">Necesitás iniciar sesión para ver el estado comercial.</p>
          <Link href="/login" className="mt-4 inline-flex rounded-xl bg-[#C56A1A] px-4 py-2 font-semibold text-white">
            Ir a login
          </Link>
        </section>
      </main>
    );
  }

  const tenantId = user.tenant.tenantId;
  const [tenantResult, membersResult, invitationsResult] = await Promise.all([
    query<TenantSummaryRow>('select trial_ends_at, tenant_type from public.tenants where id = $1', [tenantId]),
    query<CountRow>('select count(*)::text as count from public.users where tenant_id = $1', [tenantId]),
    query<CountRow>(
      "select count(*)::text as count from public.tenant_invitations where tenant_id = $1 and status = 'pending'",
      [tenantId]
    ),
  ]);

  const tenant = tenantResult.rows[0] ?? { trial_ends_at: null, tenant_type: 'home' as const };
  const membersCount = Number(membersResult.rows[0]?.count ?? '0');
  const pendingInvitations = Number(invitationsResult.rows[0]?.count ?? '0');
  const remaining = daysLeft(tenant.trial_ends_at);

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Facturación</h1>
            <p className="text-[#6B5A50]">Estado actual del tenant durante la migración.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm text-[#6B5A50]">Plan actual</p>
            <p className="text-xl font-semibold">
              {tenant.tenant_type === 'professional' ? 'Professional' : 'Home'}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Rol: {user.tenant.role} · Miembros activos: {membersCount}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Límite PDFs: {tenant.tenant_type === 'professional' ? 15 : 5}
            </p>
          </article>

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm text-[#6B5A50]">Trial</p>
            <p className="text-xl font-semibold">
              {remaining === null ? 'No disponible' : remaining > 0 ? `${remaining} días restantes` : 'Vencido'}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Fin: {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleString() : '-'}
            </p>
          </article>
        </div>

        <article className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
          <p className="text-sm text-[#6B5A50]">Estado comercial actual</p>
          <p className="mt-1 text-sm text-[#241A14]">
            Invitaciones pendientes: {pendingInvitations}. Esta pantalla ya no depende de Supabase.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/members"
              className="rounded-xl border border-[#E8DDD2] px-3 py-2 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
            >
              Gestionar miembros
            </Link>
            <Link
              href="/app"
              className="rounded-xl bg-[#C56A1A] px-3 py-2 text-sm font-semibold text-white hover:bg-[#A55412]"
            >
              Volver al panel
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
