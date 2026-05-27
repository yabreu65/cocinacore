'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = typeof params?.token === 'string' ? params.token : '';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const acceptInvitation = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) throw new Error('Primero inicia sesión para aceptar la invitación.');

      const { error: rpcErr } = await supabase.rpc('accept_tenant_invitation', {
        p_invitation_token: token,
      });
      if (rpcErr) throw rpcErr;

      setMessage('Invitación aceptada correctamente. Te redirigimos al panel.');
      window.setTimeout(() => router.push('/app'), 800);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo aceptar la invitación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-10 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-[#E8DDD2] bg-white/85 p-6 premium-shadow">
        <h1 className="text-3xl font-semibold">Unirte al tenant</h1>
        <p className="mt-2 text-sm text-[#6B5A50]">
          Estás por aceptar una invitación para colaborar en CocinaCore.
        </p>
        <p className="mt-2 rounded-xl border border-[#E8DDD2] bg-[#FAF6F1] px-3 py-2 text-xs text-[#6B5A50]">
          Token: <code>{token}</code>
        </p>

        {error ? (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        {message ? (
          <p className="mt-3 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">{message}</p>
        ) : null}

        <form className="mt-4 grid gap-3" onSubmit={acceptInvitation}>
          <button
            type="submit"
            disabled={loading}
            className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white hover:bg-[#A55412] disabled:opacity-60"
          >
            {loading ? 'Aceptando...' : 'Aceptar invitación'}
          </button>
          <Link
            href="/login"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-[#E8DDD2] px-4 text-sm font-semibold text-[#6B5A50]"
          >
            Ir a login
          </Link>
        </form>
      </section>
    </main>
  );
}
