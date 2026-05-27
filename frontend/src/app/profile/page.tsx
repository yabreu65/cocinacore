'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) throw new Error('No hay sesión activa.');

        setEmail(authData.user.email ?? '');

        const [{ data: userRow }, { data: profileRow }, { data: profileTerms }, { data: termsRows }] = await Promise.all([
          supabase.from('users').select('full_name').eq('id', authData.user.id).maybeSingle(),
          supabase.from('user_culinary_profiles').select('level').maybeSingle(),
          supabase.from('user_culinary_profile_terms').select('term_id,preference_type'),
          supabase.from('culinary_terms').select('id,label').limit(300),
        ]);

        setFullName(userRow?.full_name ?? '');
        setLevel(profileRow?.level ?? '');

        const termById = new Map((termsRows ?? []).map((row) => [row.id, row.label]));
        const labels = (profileTerms ?? [])
          .map((row) => termById.get(row.term_id))
          .filter((value): value is string => Boolean(value));
        setTags(labels);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'No se pudo cargar perfil.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error('No hay sesión activa.');

      const { error: userError } = await supabase.from('users').update({ full_name: fullName.trim() || null }).eq('id', authData.user.id);
      if (userError) throw userError;

      const { data: userTenantRow, error: tenantError } = await supabase.from('users').select('tenant_id').eq('id', authData.user.id).maybeSingle();
      if (tenantError || !userTenantRow?.tenant_id) throw new Error('No se encontró tenant del usuario.');

      const { error: profileError } = await supabase.from('user_culinary_profiles').upsert(
        {
          user_id: authData.user.id,
          tenant_id: userTenantRow.tenant_id,
          level: level.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (profileError) throw profileError;

      setMessage('Perfil actualizado correctamente.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo guardar perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Perfil</h1>
            <p className="text-[#6B5A50]">Gestioná tus datos, nivel culinario y seguridad de cuenta.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">Volver</Link>
        </div>

        {error ? <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {message ? <p className="mb-3 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">{message}</p> : null}

        <form onSubmit={onSave} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Nombre completo
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none" />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Correo
            <input value={email} disabled className="h-11 rounded-xl border border-[#E8DDD2] bg-[#F8F4EF] px-3 text-[#6B5A50]" />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Nivel culinario
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none">
              <option value="">Sin preferencia</option>
              <option value="Principiante">Principiante</option>
              <option value="Intermedio">Intermedio</option>
              <option value="Chef">Chef</option>
            </select>
          </label>

          <div>
            <p className="text-sm font-semibold text-[#6B5A50]">Preferencias detectadas</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.length > 0 ? tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[#E8DDD2] bg-white px-2.5 py-1 text-xs text-[#6B5A50]">{tag}</span>
              )) : <span className="text-xs text-[#6B5A50]">Sin etiquetas todavía.</span>}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving || loading} className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60">
              {saving ? 'Guardando...' : 'Guardar perfil'}
            </button>
            <Link href="/mfa" className="inline-flex h-11 items-center rounded-xl border border-[#E8DDD2] px-4 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40">
              Seguridad (MFA)
            </Link>
          </div>
        </form>

        {loading ? <p className="mt-3 text-sm text-[#6B5A50]">Cargando perfil...</p> : null}
      </section>
    </main>
  );
}
