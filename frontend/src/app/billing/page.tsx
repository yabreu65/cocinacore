'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function BillingPage() {
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [tenantType, setTenantType] = useState<'home' | 'professional'>('home');
  const [membersCount, setMembersCount] = useState(0);
  const [pendingInvitations, setPendingInvitations] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error('No hay sesión activa.');

        const { data: userRow, error: userError } = await supabase
          .from('users')
          .select('tenant_id,role')
          .eq('id', authData.user.id)
          .maybeSingle();
        if (userError || !userRow?.tenant_id) throw new Error('No se encontró tenant del usuario.');
        setRole(userRow.role ?? null);

        const [
          { data: tenantRow, error: tenantError },
          { count: usersCount, error: membersError },
          { count: invitesCount, error: invitesError },
        ] = await Promise.all([
          supabase
            .from('tenants')
            .select('trial_ends_at,tenant_type')
            .eq('id', userRow.tenant_id)
            .maybeSingle(),
          supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', userRow.tenant_id),
          supabase
            .from('tenant_invitations')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', userRow.tenant_id)
            .eq('status', 'pending'),
        ]);

        if (tenantError) throw tenantError;
        if (membersError) throw membersError;
        if (invitesError) throw invitesError;
        setTrialEndsAt(tenantRow?.trial_ends_at ?? null);
        setTenantType(tenantRow?.tenant_type === 'professional' ? 'professional' : 'home');
        setMembersCount(usersCount ?? 0);
        setPendingInvitations(invitesCount ?? 0);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : 'No se pudo cargar facturación.'
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const remaining = daysLeft(trialEndsAt);

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Facturación</h1>
            <p className="text-[#6B5A50]">Estado actual de tu plan y trial.</p>
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

        <div className="grid gap-3 md:grid-cols-2">
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm text-[#6B5A50]">Plan actual</p>
            <p className="text-xl font-semibold">
              {tenantType === 'professional' ? 'Professional' : 'Home'} (trial)
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Rol: {role ?? 'member'} · Miembros activos: {membersCount}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Límite PDFs: {tenantType === 'professional' ? 15 : 5}
            </p>
          </article>
          <article className="rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
            <p className="text-sm text-[#6B5A50]">Trial</p>
            <p className="text-xl font-semibold">
              {remaining === null
                ? 'No disponible'
                : remaining > 0
                  ? `${remaining} días restantes`
                  : 'Vencido'}
            </p>
            <p className="mt-1 text-xs text-[#6B5A50]">
              Fin: {trialEndsAt ? new Date(trialEndsAt).toLocaleString() : '-'}
            </p>
          </article>
        </div>

        <article className="mt-4 rounded-2xl border border-[#E8DDD2] bg-white/70 p-4">
          <p className="text-sm text-[#6B5A50]">Estado comercial actual</p>
          <p className="mt-1 text-sm text-[#241A14]">
            Invitaciones pendientes: {pendingInvitations}. Mientras estés en trial, podés seguir
            usando generación, biblioteca y planificación.
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

        {loading ? <p className="mt-3 text-sm text-[#6B5A50]">Cargando...</p> : null}
      </section>
    </main>
  );
}
