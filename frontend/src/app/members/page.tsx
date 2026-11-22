import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { scopedTransaction } from '@/lib/db';
import type { InvitationStatus, TenantRole, UserRow } from '@/lib/db/types';

export const dynamic = 'force-dynamic';

type InvitationRow = {
  id: string;
  email: string;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
};

function prettyRole(role: TenantRole): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Miembro';
}

export default async function MembersPage() {
  const user = await getCurrentUser();

  if (!user?.tenant) {
    return (
      <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-bistro-border bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Miembros</h1>
          <p className="mt-2 text-bistro-text-secondary">
            Necesitás iniciar sesión para ver el tenant.
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
  const isHome = user.tenant.tenantType === 'home';
  const { usersResult, invitations } = await scopedTransaction(
    { tenantId, userId: user.id },
    async (client) => {
      const usersResult = await client.query<
        Pick<UserRow, 'id' | 'full_name' | 'email' | 'role' | 'created_at'>
      >(
        `select id, full_name, email, role, created_at
         from public.users where tenant_id = $1 order by created_at asc`,
        [tenantId]
      );
      if (isHome) return { usersResult, invitations: [] as InvitationRow[] };
      const result = await client.query<InvitationRow>(
        `select id, email, status, expires_at, created_at
         from public.tenant_invitations where tenant_id = $1
         order by created_at desc limit 40`,
        [tenantId]
      );
      return { usersResult, invitations: result.rows };
    }
  );
  const users = usersResult.rows;
  // Only redirect a confirmed single-account home. Legacy accesses remain visible.
  if (isHome && users.length === 1 && users[0].id === user.id) redirect('/profile');
  const canManage = user.tenant.role === 'owner' || user.tenant.role === 'admin';

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 text-bistro-text-primary md:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-bistro-inverse p-5 text-white shadow-sm sm:p-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-bistro-champagne">
              Accesos del hogar
            </p>
            <h1 className="mt-2 font-bistro-heading text-3xl font-semibold sm:text-4xl">
              Miembros
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-bistro-cream">
              {isHome
                ? 'Este hogar conserva accesos históricos. No se pueden añadir nuevas cuentas.'
                : 'Vista de miembros en modo solo lectura.'}
            </p>
          </div>
          <Link
            href="/app"
            className="inline-flex min-h-11 items-center rounded-xl border border-white/40 px-3 text-sm font-semibold text-white"
          >
            Volver
          </Link>
        </div>

        <article className="rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
          <p className="text-sm font-semibold text-bistro-text-secondary">Tu rol actual</p>
          <p className="mt-1 text-lg font-semibold">{prettyRole(user.tenant.role)}</p>
          <p className="mt-2 text-sm text-bistro-text-secondary">
            {isHome
              ? 'Bistró utiliza una cuenta por hogar. Revisa los accesos existentes antes de cualquier cambio; no se han eliminado cuentas.'
              : canManage
                ? 'Invitaciones y cambios de rol no están disponibles.'
                : 'Solo owner/admin puede gestionar miembros.'}
          </p>
        </article>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">
              {isHome ? 'Accesos existentes' : 'Equipo del tenant'}
            </h2>
            <ul className="mt-3 space-y-2">
              {users.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-bistro-border bg-white/80 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{member.full_name ?? member.email}</p>
                    <p className="text-xs text-bistro-text-secondary">{member.email}</p>
                  </div>
                  <span className="rounded-full border border-bistro-border px-2 py-0.5 text-xs text-bistro-text-secondary">
                    {prettyRole(member.role)}
                  </span>
                </li>
              ))}
              {users.length === 0 ? (
                <li className="text-sm text-bistro-text-secondary">No hay miembros cargados.</li>
              ) : null}
            </ul>
          </article>

          {!isHome && (
            <article className="rounded-2xl border border-bistro-border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Invitaciones</h2>
              <div className="mt-3 rounded-xl border border-bistro-border bg-white/80 p-3 text-sm text-bistro-text-secondary">
                Crear, revocar y aceptar invitaciones está en reconstrucción.
              </div>
              <ul className="mt-3 space-y-2">
                {invitations.map((invitation) => (
                  <li
                    key={invitation.id}
                    className="rounded-xl border border-bistro-border bg-white/80 p-3 text-sm"
                  >
                    <p className="font-medium">{invitation.email}</p>
                    <p className="text-xs text-bistro-text-secondary">
                      Estado: {invitation.status} · expira{' '}
                      {new Date(invitation.expires_at).toLocaleDateString()}
                    </p>
                  </li>
                ))}
                {invitations.length === 0 ? (
                  <li className="text-sm text-bistro-text-secondary">
                    No hay invitaciones todavía.
                  </li>
                ) : null}
              </ul>
            </article>
          )}
        </div>
      </section>
    </main>
  );
}
