'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';

type UserRow = Database['public']['Tables']['users']['Row'];
type InvitationRow = Database['public']['Tables']['tenant_invitations']['Row'];

function prettyRole(role: string): string {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Miembro';
}

export default function MembersPage() {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [currentUser, setCurrentUser] = useState<UserRow | null>(null);

  const canManage = useMemo(
    () => currentUser?.role === 'owner' || currentUser?.role === 'admin',
    [currentUser?.role]
  );
  const canChangeRoles = currentUser?.role === 'owner';

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) throw new Error('No hay sesión activa.');

      const { data: meRow, error: meErr } = await supabase
        .from('users')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();
      if (meErr || !meRow?.tenant_id) throw new Error('No se pudo cargar tu perfil de tenant.');

      const [{ data: usersRows, error: usersErr }, { data: invitationRows, error: invErr }] =
        await Promise.all([
          supabase
            .from('users')
            .select('*')
            .eq('tenant_id', meRow.tenant_id)
            .order('created_at', { ascending: true }),
          supabase
            .from('tenant_invitations')
            .select('*')
            .eq('tenant_id', meRow.tenant_id)
            .order('created_at', { ascending: false })
            .limit(40),
        ]);

      if (usersErr) throw usersErr;
      if (invErr) throw invErr;

      setCurrentUser(meRow);
      setUsers((usersRows ?? []) as UserRow[]);
      setInvitations((invitationRows ?? []) as InvitationRow[]);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo cargar miembros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const inviteMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !currentUser?.tenant_id) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const token = `${currentUser.tenant_id}:${normalizedEmail}:${Date.now()}`;

      const { error: insertErr } = await supabase.from('tenant_invitations').insert({
        tenant_id: currentUser.tenant_id,
        email: normalizedEmail,
        invited_by: currentUser.id,
        role: 'member',
        invitation_token: token,
        status: 'pending',
        expires_at: expiresAt,
      });

      if (insertErr) throw insertErr;
      setEmail('');
      setMessage('Invitación creada. Podés compartir el enlace de invitación con el miembro.');
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo crear invitación.');
    } finally {
      setWorking(false);
    }
  };

  const revokeInvitation = async (invitationId: string) => {
    if (!canManage) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateErr } = await supabase
        .from('tenant_invitations')
        .update({ status: 'revoked' })
        .eq('id', invitationId);
      if (updateErr) throw updateErr;
      setMessage('Invitación revocada.');
      await load();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'No se pudo revocar invitación.'
      );
    } finally {
      setWorking(false);
    }
  };

  const updateMemberRole = async (memberId: string, role: 'admin' | 'member') => {
    if (!canManage || !currentUser?.tenant_id) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updateErr } = await supabase.rpc('update_tenant_member_role', {
        p_member_id: memberId,
        p_role: role,
      });
      if (updateErr) throw updateErr;
      setMessage('Rol actualizado correctamente.');
      await load();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : 'No se pudo actualizar el rol.'
      );
    } finally {
      setWorking(false);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!canManage) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: removeErr } = await supabase.rpc('remove_tenant_member', {
        p_member_id: memberId,
      });
      if (removeErr) throw removeErr;
      setMessage('Miembro removido del tenant.');
      await load();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo remover miembro.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-5xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Miembros</h1>
            <p className="text-[#6B5A50]">
              Gestioná quién puede participar en tu cocina compartida.
            </p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">
            Volver
          </Link>
        </div>

        {error ? (
          <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-3 rounded-xl border border-[#567A3B]/40 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">
            {message}
          </p>
        ) : null}

        <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
          <p className="text-sm font-semibold text-[#6B5A50]">Tu rol actual</p>
          <p className="mt-1 text-lg font-semibold">{prettyRole(currentUser?.role ?? 'member')}</p>
          {!canManage ? (
            <p className="mt-2 text-sm text-[#6B5A50]">
              Solo owner/admin puede invitar o revocar miembros.
            </p>
          ) : null}
        </article>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Equipo del tenant</h2>
            <ul className="mt-3 space-y-2">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/80 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{user.full_name ?? user.email ?? 'Miembro'}</p>
                    <p className="text-xs text-[#6B5A50]">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-[#E8DDD2] px-2 py-0.5 text-xs text-[#6B5A50]">
                      {prettyRole(user.role)}
                    </span>
                    {canManage && user.id !== currentUser?.id && user.role !== 'owner' ? (
                      <>
                        {canChangeRoles ? (
                          <select
                            className="rounded-lg border border-[#E8DDD2] bg-white px-2 py-1 text-xs text-[#6B5A50]"
                            value={user.role}
                            disabled={working}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (value === 'admin' || value === 'member') {
                                void updateMemberRole(user.id, value);
                              }
                            }}
                          >
                            <option value="member">Miembro</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void removeMember(user.id)}
                          disabled={working}
                          className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-60"
                        >
                          Remover
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
              {!loading && users.length === 0 ? (
                <li className="text-sm text-[#6B5A50]">No hay miembros cargados.</li>
              ) : null}
            </ul>
          </article>

          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <h2 className="text-lg font-semibold">Invitaciones</h2>
            <form onSubmit={inviteMember} className="mt-3 flex flex-wrap gap-2">
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="correo@dominio.com"
                type="email"
                disabled={!canManage || working}
                className="h-11 min-w-[220px] flex-1 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
              />
              <button
                type="submit"
                disabled={!canManage || working}
                className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
              >
                Invitar
              </button>
            </form>

            <ul className="mt-3 space-y-2">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-xs text-[#6B5A50]">
                        Estado: {invitation.status} · expira{' '}
                        {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    {canManage && invitation.status === 'pending' ? (
                      <button
                        type="button"
                        disabled={working}
                        onClick={() => void revokeInvitation(invitation.id)}
                        className="rounded-lg border border-[#E8DDD2] px-2 py-1 text-xs font-semibold text-[#A55412] hover:border-[#C56A1A]/40 disabled:opacity-60"
                      >
                        Revocar
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
              {!loading && invitations.length === 0 ? (
                <li className="text-sm text-[#6B5A50]">No hay invitaciones todavía.</li>
              ) : null}
            </ul>
          </article>
        </div>
      </section>
    </main>
  );
}
