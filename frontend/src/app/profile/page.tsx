'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { safeFetch } from '@/lib/api';

interface ProfileData {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    tenant: { tenantId: string; role: string } | null;
  };
  profile: {
    level: string | null;
  } | null;
}

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await safeFetch<ProfileData>('/api/profile', { credentials: 'same-origin' });
        if (!result.ok) throw new Error(result.error);

        setEmail(result.data.user.email ?? '');
        setFullName(result.data.user.fullName ?? '');
        setLevel(result.data.profile?.level ?? '');
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
      const result = await safeFetch<{ user: { fullName: string | null } }>('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ fullName: fullName.trim(), level: level.trim() }),
      });

      if (!result.ok) {
        throw new Error(result.error ?? 'No se pudo guardar perfil.');
      }

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
            <p className="text-[#6B5A50]">
              Gestioná tus datos, nivel culinario y seguridad de cuenta.
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
          <p className="mb-3 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">
            {message}
          </p>
        ) : null}

        <form onSubmit={onSave} className="grid gap-3">
          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Nombre completo
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Correo
            <input
              value={email}
              disabled
              className="h-11 rounded-xl border border-[#E8DDD2] bg-[#F8F4EF] px-3 text-[#6B5A50]"
            />
          </label>

          <label className="grid gap-1 text-sm font-semibold text-[#6B5A50]">
            Nivel culinario
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none"
            >
              <option value="">Sin preferencia</option>
              <option value="Principiante">Principiante</option>
              <option value="Intermedio">Intermedio</option>
              <option value="Chef">Chef</option>
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving || loading}
              className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60"
            >
              {saving ? 'Guardando...' : 'Guardar perfil'}
            </button>
            <Link
              href="/mfa"
              className="inline-flex h-11 items-center rounded-xl border border-[#E8DDD2] px-4 text-sm font-semibold text-[#6B5A50] hover:border-[#C56A1A]/40"
            >
              Seguridad (MFA)
            </Link>
          </div>
        </form>

        {loading ? <p className="mt-3 text-sm text-[#6B5A50]">Cargando perfil...</p> : null}
      </section>
    </main>
  );
}
