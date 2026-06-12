'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { mapAuthError } from '@/lib/auth/errors';

interface MfaFactor {
  id: string;
  factor_type: string;
  status: string;
  friendly_name?: string;
}

export default function MfaPage() {
  const router = useRouter();
  const [factor, setFactor] = useState<MfaFactor | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingFactor, setLoadingFactor] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFactor = async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;

        const verifiedTotpFactor = (data.all as MfaFactor[]).find(
          (item) => item.factor_type === 'totp' && item.status === 'verified'
        );

        if (!cancelled) {
          setFactor(verifiedTotpFactor ?? null);
          if (!verifiedTotpFactor) {
            setErrorMessage('No encontramos un factor MFA verificado para esta sesión.');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(mapAuthError(error, 'mfa'));
        }
      } finally {
        if (!cancelled) setLoadingFactor(false);
      }
    };

    void loadFactor();

    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!factor) return;

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });

      if (error) throw error;

      setSuccessMessage('Código verificado correctamente. Redirigiendo...');
      router.push('/app');
      router.refresh();
    } catch (error) {
      setErrorMessage(mapAuthError(error, 'mfa'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-10 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-[#E8DDD2] bg-white/85 p-6 premium-shadow">
        <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">
          COCINACORE • SEGURIDAD
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Verificación en dos pasos</h1>
        <p className="mt-2 text-sm text-[#6B5A50]">
          Ingresá el código de tu app autenticadora para continuar.
        </p>

        {errorMessage ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mt-4 rounded-xl border border-[#567A3B]/30 bg-[#567A3B]/10 px-3 py-2 text-sm text-[#567A3B]">
            {successMessage}
          </p>
        ) : null}

        <form className="mt-5 grid gap-4" onSubmit={onSubmit}>
          <div className="grid gap-2">
            <label htmlFor="mfa-code" className="text-sm font-semibold text-[#3A2D24]">
              Código MFA
            </label>
            <input
              id="mfa-code"
              type="text"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              minLength={6}
              maxLength={6}
              required
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
            />
          </div>

          <button
            type="submit"
            disabled={loading || loadingFactor || !factor || code.length !== 6}
            className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-60"
          >
            {loading ? 'Verificando...' : loadingFactor ? 'Cargando factor...' : 'Verificar código'}
          </button>
        </form>
      </section>
    </main>
  );
}
