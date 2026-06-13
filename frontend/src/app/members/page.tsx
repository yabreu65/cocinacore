import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/server';
import { query } from '@/lib/db';
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
      <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
          <h1 className="text-3xl font-semibold">Miembros</h1>
          <p className="mt-2 text-[#6B5A50]">Necesitás iniciar sesión para ver el tenant.</p>
          <Link href="/login" className="mt-4 inline-flex rounded-xl bg-[#C56A1A] px-4 py-2 font-semibold text-white">
            Ir a login
          </Link>
        </section>
      </main>
    );
  }

  const tenantId = user.tenant.tenantId;
  const [usersResult, invitationsResult] = await Promise.all([
    query<Pick<UserRow, 'id' | 'full_name' | 'email' | 'role' | 'created_at'>>(
      `select id, full_name, email, role, created_at
       from public.users
       where tenant_id = $1
       order by created_at asc`,
      [tenantId]
    ),
    query<InvitationRow>(
      `select id, email, status, expires_at, created_at
       from public.tenant_invitations
       where tenant_id = $1
       order by created_at desc
       limit 40`,
      [tenantId]
    ),
  ]);

  const users = usersResult.rows;
  const invitations = invitationsResult.rows;
  const canManage = user.tenant.role === 'owner' || user.tenant.role === 'admin';

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Miembros</h1>
            <p className="text-[#6B5A50]">Vista migrada a PostgreSQL directo, en modo solo lectura.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
          <p className="text-sm font-semibold text-[#6B5A50]">Tu rol actual</p>
          <p className="mt-1 text-lg font-semibold">{prettyRole(user.tenant.role)}</p>
          <p className="mt-2 text-sm text-[#6B5A50]">
            {canManage
              ? 'Invitaciones y cambios de rol se están reconstruyendo.'
              : 'Solo owner/admin puede gestionar miembros.'}
          </p>
        </article>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Equipo del tenant</h2>
            <ul className="mt-3 space-y-2">
              {users.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{member.full_name ?? member.email}</p>
                    <p className="text-xs text-[#6B5A50]">{member.email}</p>
                  </div>
                  <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5 text-xs text-[#6B5A50]">
                    {prettyRole(member.role)}
                  </span>
                </li>
              ))}
              {users.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay miembros cargados.</li> : null}
            </ul>
          </article>

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Invitaciones</h2>
            <div className="mt-3 rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm text-[#6B5A50]">
              Crear, revocar y aceptar invitaciones está en reconstrucción.
            </div>
            <ul className="mt-3 space-y-2">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm">
                  <p className="font-medium">{invitation.email}</p>
                  <p className="text-xs text-[#6B5A50]">
                    Estado: {invitation.status} · expira {new Date(invitation.expires_at).toLocaleDateString()}
                  </p>
                </li>
              ))}
              {invitations.length === 0 ? <li className="text-sm text-[#6B5A50]">No hay invitaciones todavía.</li> : null}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
