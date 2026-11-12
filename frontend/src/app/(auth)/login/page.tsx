'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { humanCopy } from '@/lib/copy';
import { mapAuthError } from '@/lib/auth/errors';
import { getSafeRedirectPath } from '@/lib/auth/safeRedirect';

const features = [
  'Biblioteca culinaria inteligente',
  'Recetas personalizadas',
  'Inventario inteligente',
  'Seguro y privado',
  'Ideal para familias',
];

const floatingCards = [
  {
    title: humanCopy.suggestedRecipesForYou,
    text: 'Risotto cremoso según tu inventario',
    accent: 'var(--color-brand-forest)',
  },
  {
    title: 'Tip del chef',
    text: 'Sellá proteína antes de bajar el fuego',
    accent: 'var(--color-brand-burgundy)',
  },
  {
    title: 'PDF consultado',
    text: 'Cocina Familiar Vol.2.pdf',
    accent: 'var(--color-brand-forest)',
  },
  {
    title: 'Ingredientes disponibles',
    text: 'Tomate · Pollo · Ajo · Cebolla',
    accent: 'var(--color-brand-burgundy)',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [oauthTermsAccepted, setOauthTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get('error');
    if (error) {
      setErrorMessage(error);
    }
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setErrorMessage(body?.error ?? mapAuthError(null, 'login'));
        return;
      }

      setSuccessMessage('Sesión iniciada correctamente. Redirigiendo...');
      const next = getSafeRedirectPath(new URLSearchParams(window.location.search).get('next'));
      router.push(next);
      router.refresh();
    } catch (error) {
      setErrorMessage(mapAuthError(error, 'login'));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setOauthLoading(provider);

    if (!oauthTermsAccepted) {
      setErrorMessage('Aceptá términos y privacidad para continuar.');
      setOauthLoading(null);
      return;
    }

    await Promise.resolve();
    setErrorMessage('Funcionalidad en reconstrucción. Usá email y contraseña por ahora.');
    setOauthLoading(null);
  };

  return (
    <main className="texture-paper min-h-screen bg-bistro-page px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto grid w-full max-w-[1220px] overflow-hidden rounded-[2rem] border border-bistro-border bg-white/55 premium-shadow lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative hidden overflow-hidden border-b border-bistro-border p-6 md:p-10 lg:block lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-bistro-action-secondary/10 blur-3xl" />
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <p className="text-xs font-bold tracking-[0.15em] text-bistro-action-primary">
              COCINACORE • TU HOGAR
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.08] text-bistro-text-primary md:text-5xl">
              Bienvenido de nuevo a tu cocina inteligente
            </h1>
            <p className="mt-4 max-w-xl text-lg text-bistro-text-secondary">
              Accede a tus recetas, biblioteca culinaria, inventario y recetas sugeridas desde
              cualquier lugar.
            </p>

            <div className="mt-7 rounded-2xl border border-bistro-border bg-bistro-inverse p-4 text-bistro-cream dark-panel-shadow">
              <div className="grid gap-3 sm:grid-cols-2">
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-bistro-champagne">
                    {humanCopy.suggestedRecipesForYou}
                  </p>
                  <p className="mt-1 text-sm font-semibold">Pasta cremosa con champiñones</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-bistro-champagne">Inventario</p>
                  <p className="mt-1 text-sm font-semibold">Tomate x6 · Pollo 1.2kg</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-bistro-champagne">PDF culinarios</p>
                  <p className="mt-1 text-sm font-semibold">Recetario de la Abuela.pdf</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-bistro-champagne">Tip del chef</p>
                  <p className="mt-1 text-sm font-semibold">Reposá la salsa 10 minutos</p>
                </article>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {floatingCards.map((card, index) => (
                <motion.article
                  key={card.title}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * index, duration: 0.3 }}
                  className="rounded-2xl border border-bistro-border bg-white/80 p-4"
                >
                  <p className="text-sm font-semibold" style={{ color: card.accent }}>
                    {card.title}
                  </p>
                  <p className="mt-1 text-sm text-bistro-text-secondary">{card.text}</p>
                </motion.article>
              ))}
            </div>

            <ul className="mt-7 grid gap-2 text-sm text-bistro-text-secondary sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-bistro-action-secondary/20 text-xs font-bold text-bistro-action-secondary">
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
            <p className="mb-3 text-xs font-bold tracking-[0.15em] text-bistro-action-primary lg:hidden">
              COCINACORE • TU HOGAR
            </p>
            <h2 className="text-3xl font-semibold text-bistro-text-primary">Iniciar sesión</h2>
            <p className="mt-2 text-bistro-text-secondary">
              Continúa organizando tu cocina con asistencia inteligente.
            </p>

            <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
              <div className="grid gap-2">
                <label
                  htmlFor="login-email"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Correo electrónico
                </label>
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  required
                  className="h-11 rounded-xl border border-bistro-border bg-white px-3 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                />
              </div>

              <div className="grid gap-2">
                <label
                  htmlFor="login-password"
                  className="text-sm font-semibold text-bistro-text-primary"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    required
                    className="h-11 w-full rounded-xl border border-bistro-border bg-white px-3 pr-24 text-bistro-text-primary outline-none transition focus:border-bistro-action-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-bistro-text-secondary hover:text-bistro-action-primary"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 text-sm">
                <Link
                  href="/forgot-password"
                  className="font-semibold text-bistro-action-primary hover:text-bistro-action-primary"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>

              {errorMessage ? (
                <p className="rounded-xl bg-bistro-danger/10 px-3 py-2 text-sm text-bistro-danger">
                  {errorMessage}
                </p>
              ) : null}
              {successMessage ? (
                <p className="rounded-xl bg-bistro-success/10 px-3 py-2 text-sm text-bistro-success">
                  {successMessage}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-11 rounded-xl bg-bistro-action-primary font-semibold text-white transition hover:bg-bistro-action-primary disabled:opacity-70"
              >
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-bistro-border" />
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-bistro-text-secondary">
                o continuar con
              </span>
              <div className="h-px flex-1 bg-bistro-border" />
            </div>

            <label className="mb-3 flex items-start gap-3 text-sm text-bistro-text-secondary">
              <input
                type="checkbox"
                checked={oauthTermsAccepted}
                onChange={(event) => setOauthTermsAccepted(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-bistro-border accent-bistro-action-primary"
              />
              Acepto términos y privacidad si esta es mi primera vez con OAuth.
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleOAuth('google')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-bistro-border bg-white font-semibold text-bistro-text-primary transition hover:border-bistro-action-primary disabled:opacity-70"
              >
                {oauthLoading === 'google' ? 'Conectando...' : 'Google'}
              </button>
              <button
                type="button"
                onClick={() => void handleOAuth('github')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-bistro-border bg-white font-semibold text-bistro-text-primary transition hover:border-bistro-action-primary disabled:opacity-70"
              >
                {oauthLoading === 'github' ? 'Conectando...' : 'GitHub'}
              </button>
            </div>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
