'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import { humanCopy } from '@/lib/copy';

const features = [
  'Biblioteca culinaria inteligente',
  'Recetas personalizadas',
  'Inventario inteligente',
  'Seguro y privado',
  'Ideal para familias',
];

const floatingCards = [
  { title: humanCopy.suggestedRecipesForYou, text: 'Risotto cremoso según tu inventario', accent: '#6D4AFF' },
  { title: 'Tip del chef', text: 'Sellá proteína antes de bajar el fuego', accent: '#C56A1A' },
  { title: 'PDF consultado', text: 'Cocina Familiar Vol.2.pdf', accent: '#567A3B' },
  { title: 'Ingredientes disponibles', text: 'Tomate · Pollo · Ajo · Cebolla', accent: '#C56A1A' },
];

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<'google' | 'github' | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberSession, setRememberSession] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      setSuccessMessage('Sesión iniciada correctamente. Redirigiendo...');
      router.push('/app');
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'github') => {
    setErrorMessage(null);
    setSuccessMessage(null);
    setOauthLoading(provider);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/app`,
        },
      });

      if (error) {
        setErrorMessage(error.message);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `No se pudo continuar con ${provider}.`);
    } finally {
      setOauthLoading(null);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 md:px-6 md:py-8">
      <div className="mx-auto grid w-full max-w-[1220px] overflow-hidden rounded-[2rem] border border-[#E8DDD2] bg-white/55 premium-shadow lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden border-b border-[#E8DDD2] p-6 md:p-10 lg:border-b-0 lg:border-r">
          <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-[#6D4AFF]/10 blur-3xl" />
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="text-xs font-bold tracking-[0.15em] text-[#C56A1A]">COCINACORE • LOGIN PREMIUM</p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.08] text-[#241A14] md:text-5xl">
              Bienvenido de nuevo a tu cocina inteligente
            </h1>
            <p className="mt-4 max-w-xl text-lg text-[#6B5A50]">
              Accede a tus recetas, biblioteca culinaria, inventario y recetas sugeridas desde cualquier lugar.
            </p>

            <div className="mt-7 rounded-2xl border border-[#E8DDD2] bg-[#16110D] p-4 text-[#F5ECE2] dark-panel-shadow">
              <div className="grid gap-3 sm:grid-cols-2">
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-[#D8C8B8]">{humanCopy.suggestedRecipesForYou}</p>
                  <p className="mt-1 text-sm font-semibold">Pasta cremosa con champiñones</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-[#D8C8B8]">Inventario</p>
                  <p className="mt-1 text-sm font-semibold">Tomate x6 · Pollo 1.2kg</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-[#D8C8B8]">PDF culinarios</p>
                  <p className="mt-1 text-sm font-semibold">Recetario de la Abuela.pdf</p>
                </article>
                <article className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <p className="text-xs text-[#D8C8B8]">Tip del chef</p>
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
                  className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4"
                >
                  <p className="text-sm font-semibold" style={{ color: card.accent }}>
                    {card.title}
                  </p>
                  <p className="mt-1 text-sm text-[#6B5A50]">{card.text}</p>
                </motion.article>
              ))}
            </div>

            <ul className="mt-7 grid gap-2 text-sm text-[#6B5A50] sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <span className="inline-grid h-5 w-5 place-items-center rounded-full bg-[#567A3B]/20 text-xs font-bold text-[#567A3B]">✓</span>
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
            <h2 className="text-3xl font-semibold text-[#241A14]">Iniciar sesión</h2>
            <p className="mt-2 text-[#6B5A50]">Continúa organizando tu cocina con asistencia inteligente.</p>

            <form onSubmit={onSubmit} className="mt-6 grid gap-4" noValidate>
              <div className="grid gap-2">
                <label htmlFor="login-email" className="text-sm font-semibold text-[#3A2D24]">Correo electrónico</label>
                <input id="login-email" type="email" name="email" required className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 text-[#241A14] outline-none transition focus:border-[#C56A1A]" />
              </div>

              <div className="grid gap-2">
                <label htmlFor="login-password" className="text-sm font-semibold text-[#3A2D24]">Contraseña</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    required
                    className="h-11 w-full rounded-xl border border-[#E8DDD2] bg-white px-3 pr-24 text-[#241A14] outline-none transition focus:border-[#C56A1A]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#6B5A50] hover:text-[#C56A1A]"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex items-center gap-2 text-[#6B5A50]" title="Próximamente persistencia configurable de sesión">
                  <input
                    type="checkbox"
                    checked={rememberSession}
                    onChange={(event) => setRememberSession(event.target.checked)}
                    className="h-4 w-4 rounded border-[#E8DDD2] accent-[#C56A1A]"
                  />
                  Recordar sesión
                </label>
                <a href="#" className="font-semibold text-[#A55412] hover:text-[#C56A1A]">¿Olvidaste tu contraseña?</a>
              </div>

              {errorMessage && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>}
              {successMessage && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>}

              <button type="submit" disabled={loading} className="mt-1 h-11 rounded-xl bg-[#C56A1A] font-semibold text-white transition hover:bg-[#A55412] disabled:opacity-70">
                {loading ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-[#E8DDD2]" />
              <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8B796B]">o continuar con</span>
              <div className="h-px flex-1 bg-[#E8DDD2]" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleOAuth('google')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white font-semibold text-[#3C2E24] transition hover:border-[#C56A1A] disabled:opacity-70"
              >
                {oauthLoading === 'google' ? 'Conectando...' : 'Google'}
              </button>
              <button
                type="button"
                onClick={() => handleOAuth('github')}
                disabled={oauthLoading !== null}
                className="h-11 rounded-xl border border-[#E8DDD2] bg-white font-semibold text-[#3C2E24] transition hover:border-[#6D4AFF] disabled:opacity-70"
              >
                {oauthLoading === 'github' ? 'Conectando...' : 'GitHub'}
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-[#6B5A50]">
              ¿No tienes cuenta?{' '}
              <Link href="/signup" className="font-semibold text-[#A55412] hover:text-[#C56A1A]">
                Crear cuenta
              </Link>
            </p>
          </motion.div>
        </section>
      </div>
    </main>
  );
}
