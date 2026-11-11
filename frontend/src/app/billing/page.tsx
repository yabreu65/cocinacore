import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';
import { scopedTransaction } from '@/lib/db';
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
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
        <section className="mx-auto w-full max-w-3xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Facturación</h1>
          <p className="mt-2 text-bistro-text-secondary">
            Necesitás iniciar sesión para ver el estado comercial.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-flex rounded-xl bg-bistro-action-primary px-4 py-2 font-semibold text-white"
          >
            Ir a login
          </Link>
        </section>
      </main>
    );
  }

  const tenantId = user.tenant.tenantId;
  const [tenantResult, membersResult, invitationsResult] = await scopedTransaction(
    { tenantId, userId: user.id },
    async (client) =>
      Promise.all([
        client.query<TenantSummaryRow>(
          'select trial_ends_at, tenant_type from public.tenants where id = $1',
          [tenantId]
        ),
        client.query<CountRow>(
          'select count(*)::text as count from public.users where tenant_id = $1',
          [tenantId]
        ),
        client.query<CountRow>(
          "select count(*)::text as count from public.tenant_invitations where tenant_id = $1 and status = 'pending'",
          [tenantId]
        ),
      ])
  );

  const tenant = tenantResult.rows[0] ?? { trial_ends_at: null, tenant_type: 'home' as const };
  const membersCount = Number(membersResult.rows[0]?.count ?? '0');
  const pendingInvitations = Number(invitationsResult.rows[0]?.count ?? '0');
  const remaining = daysLeft(tenant.trial_ends_at);

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Facturación</h1>
            <p className="text-bistro-text-secondary">
              Estado actual del tenant durante la migración.
            </p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-bistro-action-primary">
            Volver
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <article className="rounded-2xl border border-bistro-border bg-white/70 p-4">
            <p className="text-sm text-bistro-text-secondary">Plan actual</p>
            <p className="text-xl font-semibold">
              {tenant.tenant_type === 'professional' ? 'Professional' : 'Home'}
            </p>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Rol: {user.tenant.role} · Miembros activos: {membersCount}
            </p>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Límite PDFs: {tenant.tenant_type === 'professional' ? 15 : 5}
            </p>
          </article>

          <article className="rounded-2xl border border-bistro-border bg-white/70 p-4">
            <p className="text-sm text-bistro-text-secondary">Trial</p>
            <p className="text-xl font-semibold">
              {remaining === null
                ? 'No disponible'
                : remaining > 0
                  ? `${remaining} días restantes`
                  : 'Vencido'}
            </p>
            <p className="mt-1 text-xs text-bistro-text-secondary">
              Fin: {tenant.trial_ends_at ? new Date(tenant.trial_ends_at).toLocaleString() : '-'}
            </p>
          </article>
        </div>

        <article className="mt-4 rounded-2xl border border-bistro-border bg-white/70 p-4">
          <p className="text-sm text-bistro-text-secondary">Estado comercial actual</p>
          <p className="mt-1 text-sm text-bistro-text-primary">
            Invitaciones pendientes: {pendingInvitations}. Esta pantalla ya no depende del backend
            anterior.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/members"
              className="rounded-xl border border-bistro-border px-3 py-2 text-sm font-semibold text-bistro-text-secondary hover:border-bistro-action-primary/40"
            >
              Gestionar miembros
            </Link>
            <Link
              href="/app"
              className="rounded-xl bg-bistro-action-primary px-3 py-2 text-sm font-semibold text-white hover:bg-bistro-action-primary"
            >
              Volver al panel
            </Link>
          </div>
        </article>
      </section>
    </main>
  );
}
