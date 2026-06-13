'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  LayoutGrid,
  Sparkles,
  Package,
  Library,
  CalendarDays,
  Crown,
  User,
  Users,
  CreditCard,
} from 'lucide-react';
import { humanCopy } from '@/lib/copy';
import { safeFetch } from '@/lib/api';

type DashboardData = {
  userId: string | null;
  fullName: string;
  tenantId: string | null;
  tenantType: 'home' | 'professional';
  trialEndsAt: string | null;
  inventory: Array<{ id: string; name: string; quantity: string | null }>;
  recentRecipes: Array<{
    id: string;
    title: string;
    createdAt: string;
    feedback: 'accepted' | 'discarded' | null;
  }>;
  pdfCount: number;
  latestPdfs: unknown[];
  tenantBooks: Array<{ id: string; title: string }>;
  culinaryProfile: {
    level: string | null;
    identity: string[];
    preferred: string[];
    avoid: string[];
    goals: string[];
  };
  activity: string[];
};

const sidebarItems = [
  { label: 'Inicio', icon: LayoutGrid, active: true, href: '/app' },
  { label: humanCopy.assistantRecipesNav, icon: Sparkles, href: '/recipes/search' },
  { label: 'Planificador', icon: CalendarDays, href: '/meal-planner' },
  { label: 'Inventario', icon: Package, href: '/recipes/inventory' },
  { label: 'Biblioteca', icon: Library, href: '/library' },
  { label: 'Tablero Premium', icon: Crown, href: '/app/premium' },
  { label: 'Miembros', icon: Users, href: '/members' },
  { label: 'Perfil', icon: User, href: '/profile' },
  { label: 'Facturación', icon: CreditCard, href: '/billing' },
];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
      const result = await safeFetch<DashboardData>('/api/dashboard', {
        credentials: 'same-origin',
      });
      if (!result.ok) throw new Error(result.error);
      setData(result.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error desconocido.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    window.location.href = '/login';
  };

  return (
    <div className="flex min-h-screen bg-[#FAF6F1]">
      <aside className="hidden w-64 flex-col border-r border-[#E8DDD2] bg-white p-4 md:flex">
        <div className="mb-6 text-xl font-bold text-[#A55412]">CocinaCore</div>
        <nav className="grid gap-1">
          {sidebarItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                item.active
                  ? 'bg-[#A55412]/10 text-[#A55412]'
                  : 'text-[#6B5A50] hover:bg-[#F8F4EF]'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-auto rounded-xl px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          Cerrar sesión
        </button>
      </aside>

      <main className="flex-1 px-4 py-6 md:px-6">
        <section className="mx-auto w-full max-w-5xl">
          <h1 className="text-3xl font-semibold text-[#241A14]">
            Hola, {data?.fullName || 'chef'}
          </h1>
          <p className="mt-1 text-[#6B5A50]">Este es tu resumen de cocina.</p>

          {loading ? <p className="mt-4 text-sm text-[#6B5A50]">Cargando...</p> : null}
          {error ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {data ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                <h2 className="font-semibold text-[#241A14]">Inventario reciente</h2>
                <ul className="mt-2 grid gap-1 text-sm">
                  {data.inventory.length > 0 ? (
                    data.inventory.map((item) => (
                      <li key={item.id} className="text-[#6B5A50]">
                        {item.name} {item.quantity ? `— ${item.quantity}` : ''}
                      </li>
                    ))
                  ) : (
                    <li className="text-[#6B5A50]">Sin ingredientes todavía.</li>
                  )}
                </ul>
                <Link
                  href="/recipes/inventory"
                  className="mt-3 inline-block text-sm font-semibold text-[#A55412]"
                >
                  Ver inventario
                </Link>
              </div>

              <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                <h2 className="font-semibold text-[#241A14]">Recetas recientes</h2>
                <ul className="mt-2 grid gap-1 text-sm">
                  {data.recentRecipes.length > 0 ? (
                    data.recentRecipes.map((recipe) => (
                      <li key={recipe.id} className="text-[#6B5A50]">
                        {recipe.title}
                      </li>
                    ))
                  ) : (
                    <li className="text-[#6B5A50]">Sin recetas generadas.</li>
                  )}
                </ul>
                <Link
                  href="/recipes/search"
                  className="mt-3 inline-block text-sm font-semibold text-[#A55412]"
                >
                  Generar receta
                </Link>
              </div>

              <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                <h2 className="font-semibold text-[#241A14]">Planificación</h2>
                <p className="mt-2 text-sm text-[#6B5A50]">
                  Planificá tu próximo menú basado en inventario y preferencias.
                </p>
                <Link
                  href="/meal-planner"
                  className="mt-3 inline-block text-sm font-semibold text-[#A55412]"
                >
                  Ir al planificador
                </Link>
              </div>

              <div className="rounded-2xl border border-[#E8DDD2] bg-white/80 p-4">
                <h2 className="font-semibold text-[#241A14]">Biblioteca PDF</h2>
                <p className="mt-2 text-sm text-[#6B5A50]">
                  {data.pdfCount} PDF{data.pdfCount === 1 ? '' : 's'} disponible
                  {data.pdfCount === 1 ? '' : 's'}.
                </p>
                <Link
                  href="/library"
                  className="mt-3 inline-block text-sm font-semibold text-[#A55412]"
                >
                  Ver biblioteca
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
