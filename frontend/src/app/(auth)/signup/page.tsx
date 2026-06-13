'use client';

import Link from 'next/link';
import { type FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { humanCopy } from '@/lib/copy';
import { mapAuthError } from '@/lib/auth/errors';

const features = [
  'Recetas personalizadas',
  'Biblioteca PDF inteligente',
  'Inventario culinario',
  'Privado y seguro',
  'Ideal para familias',
];

const floatingCards = [
  {
    title: humanCopy.suggestedRecipesForYou,
    text: 'Pasta cremosa con ingredientes disponibles',
    accent: '#6D4AFF',
  },
  { title: 'Tip del chef', text: 'Dejá reposar la salsa 10 minutos', accent: '#C56A1A' },
  { title: 'PDF culinario', text: 'Recetario Familiar.pdf indexado', accent: '#567A3B' },
  { title: 'Inventario', text: 'Tomate x6 · Pollo 1.2kg · Ajo x2', accent: '#C56A1A' },
];

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const passwordStrengthHint = useMemo(
    () => 'Usá 8+ caracteres, incluyendo mayúsculas, minúsculas y número.',
    []
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const fullName = String(formData.get('fullName') ?? '').trim();
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const confirmPassword = String(formData.get('confirmPassword') ?? '');
    const acceptedTerms = formData.get('termsAccepted') === 'on';

    if (fullName.length < 3) {
      setErrorMessage('Ingresá tu nombre completo.');
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          email,
          password,
          confirmPassword,
          termsAccepted: acceptedTerms,
        }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorMessage(body?.error ?? mapAuthError(null, 'signup'));
        return;
      }

      if (response.headers.get('X-Auth-Has-Session') === 'true') {
        setSuccessMessage('Cuenta creada. Redirigiendo al dashboard...');
        event.currentTarget.reset();
        setTermsAccepted(false);
        router.push('/app');
        router.refresh();
        return;
      }

      setSuccessMessage('Cuenta creada correctamente. Ya podés iniciar sesión.');
      event.currentTarget.reset();
      setTermsAccepted(false);
    } catch (error) {
      setErrorMessage(mapAuthError(error, 'signup'));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setOauthLoading(provider);

    if (!termsAccepted) {
      setErrorMessage('Debés aceptar términos y privacidad.');
      setOauthLoading(null);
      return;
    }

    await Promise.resolve();
    setErrorMessage('Funcionalidad en reconstrucción. Creá la cuenta con email por ahora.');
    setOauthLoading(null);
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto grid w-full max-w-[1220px] overflow-hidden rounded-[2rem] border border-[#E8DDD2] bg-white/55 premium-shadow lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden border-b border-[#E8DDD2] p-6 md:p-10 lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-[#C56A1A]/10 blur-3xl" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">
              COCINACORE • REGISTRO PREMIUM
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.08] text-[#241A14] md:text-5xl">
              Empieza a construir tu recetario familiar inteligente
            </h1>
            <p className="mt-4 max-w-xl text-lg text-[#6B5A50]">
              Guarda recetas, crea platos con ayuda, organiza ingredientes y deja tu cocina viva
              para tu familia.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {floatingCards.map((card, index) => (
                <motion.article
                  key={card.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * index, duration: 0.3 }}
                  className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4"
                >
                  <p className="text-sm font-semibold" style={{ color: card.accent }}>
                    {card.title}
                  </p>
                  <p className="mt-1 text-sm text-[#6B5A50]">{card.text}</p>
                </motion.article>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-[#E8DDD2] bg-[#16110D] p-4 text-[#F3E6D8]">
              <p className="text-sm font-medium">Biblioteca culinaria viva</p>
              <p className="mt-1 text-sm text-[#D8C8B8]">
                Todo lo que cocinan hoy, queda organizado para mañana.
              </p>
            </div>

            <ul className="mt-7 grid gap-2 text-sm text-[#6B5A50] sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-[#567A3B]/20 text-xs font-bold text-[#567A3B]">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </motion.div>
        </section>

        <section className="flex items-center p-5 md:p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="w-full rounded-3xl border border-white/70 bg-white/70 p-6 shadow-[0_20px_36px_rgba(36,26,20,0.12)] backdrop-blur-md md:p-8"
          >
            <h2 className="text-3xl font-semibold text-[#241A14]">Crear cuenta</h2>
            <p className="mt-2 text-[#6B5A50]">
              Empieza gratis y organiza tu cocina con asistencia inteligente.
            </p>

            <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
              <div className="grid gap-2">
                <label htmlFor="signup-name" className="text-sm font-semibold text-[#3A2D24]">
                  Nombre completo
                </label>
                <input
                  id="signup-name"
                  name="fullName"
                  required
                  className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="signup-email" className="text-sm font-semibold text-[#3A2D24]">
                  Correo
                </label>
                <input
                  id="signup-email"
                  type="email"
                  name="email"
                  required
                  className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
                />
              </div>
              <div className="grid gap-2">
                <label htmlFor="signup-password" className="text-sm font-semibold text-[#3A2D24]">
                  Contraseña
                </label>
                <input
                  id="signup-password"
                  type="password"
                  name="password"
                  minLength={8}
                  required
                  className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor="signup-confirm-password"
                  className="text-sm font-semibold text-[#3A2D24]"
                >
                  Confirmar contraseña
                </label>
                <input
                  id="signup-confirm-password"
                  type="password"
                  name="confirmPassword"
                  minLength={8}
                  required
                  className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
                />
              </div>

              <p className="text-xs text-[#7D6A5D]">{passwordStrengthHint}</p>

              <label className="flex items-start gap-3 text-sm text-[#6B5A50]">
                <input
                  name="termsAccepted"
                  type="checkbox"
                  required
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-[#E8DDD2] accent-[#C56A1A]"
                />
                Acepto términos y privacidad
              </label>

              {errorMessage ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                  {errorMessage}
                </p>
              ) : null}
              {successMessage ? (
                <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  {successMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-11 rounded-xl bg-[#C56A1A] font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-70"
              >
                {loading ? 'Creando cuenta...' : 'Crear cuenta gratis'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#E8DDD2]" />
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8B796B]">
                o continuar con
              </span>
              <div className="h-px flex-1 bg-[#E8DDD2]" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleOAuth('google')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white font-semibold text-[#3C2E24] transition hover:border-[#C56A1A] disabled:opacity-70"
              >
                {oauthLoading === 'google' ? 'Conectando...' : 'Google'}
              </button>
              <button
                type="button"
                onClick={() => void handleOAuth('github')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white font-semibold text-[#3C2E24] transition hover:border-[#C56A1A] disabled:opacity-70"
              >
                {oauthLoading === 'github' ? 'Conectando...' : 'GitHub'}
              </button>
            </div>

            <p className="mt-5 text-center text-sm text-[#6B5A50]">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="font-semibold text-[#A55412] hover:text-[#C56A1A]">
                Iniciar sesión
              </Link>
            </p>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
