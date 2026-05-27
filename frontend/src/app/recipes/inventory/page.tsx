'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';

type InventoryRow = {
  id: string;
  ingredient_name: string;
  quantity: string | null;
};

type SuggestedInventoryItem = {
  canonical_name: string;
  display_name: string;
  quantity: number | null;
  unit: string;
};

export default function RecipeInventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedCount, setSuggestedCount] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) throw new Error('Sin sesión activa.');
      const userId = authData.user.id;

      const [{ data, error: queryErr }, { data: suggestionRow, error: suggestionErr }] = await Promise.all([
        supabase
          .from('recipe_inventory_items')
          .select('id,ingredient_name,quantity')
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('user_meal_plan_inventory_suggestions')
          .select('normalized_items')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);
      if (suggestionErr) throw suggestionErr;

      const suggestedItems = Array.isArray(suggestionRow?.normalized_items)
        ? (suggestionRow.normalized_items as unknown as SuggestedInventoryItem[])
        : [];

      setSuggestedCount(suggestedItems.length);
      if (queryErr) throw queryErr;
      setRows((data ?? []) as InventoryRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar inventario.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) return;
    setWorking(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error('Sin sesión activa.');

      const { data: userRow, error: profileErr } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', userData.user.id)
        .maybeSingle();
      if (profileErr || !userRow?.tenant_id) throw new Error('No se encontró tenant del usuario.');

      const { data: existingRow, error: existingErr } = await supabase
        .from('recipe_inventory_items')
        .select('id')
        .eq('tenant_id', userRow.tenant_id)
        .eq('user_id', userData.user.id)
        .ilike('ingredient_name', value)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existingRow?.id) {
        const { error: updateErr } = await supabase
          .from('recipe_inventory_items')
          .update({ ingredient_name: value, quantity: quantity.trim() || null })
          .eq('id', existingRow.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from('recipe_inventory_items').insert({
          tenant_id: userRow.tenant_id,
          user_id: userData.user.id,
          ingredient_name: value,
          quantity: quantity.trim() || null,
        });
        if (insertErr) throw insertErr;
      }

      setName('');
      setQuantity('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar ingrediente.');
    } finally {
      setWorking(false);
    }
  };

  const applySuggestedInventory = async () => {
    setWorking(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData.user) throw new Error('Sin sesión activa.');
      const userId = authData.user.id;

      const { data: userRow, error: userErr } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', userId)
        .maybeSingle();
      if (userErr || !userRow?.tenant_id) throw new Error('No se encontró tenant del usuario.');

      const { data: suggestionRow, error: suggestionErr } = await supabase
        .from('user_meal_plan_inventory_suggestions')
        .select('normalized_items')
        .eq('user_id', userId)
        .maybeSingle();
      if (suggestionErr) throw suggestionErr;

      const suggestedItems = Array.isArray(suggestionRow?.normalized_items)
        ? (suggestionRow.normalized_items as unknown as SuggestedInventoryItem[])
        : [];
      if (suggestedItems.length === 0) {
        setError('No hay inventario sugerido desde menú para aplicar todavía.');
        return;
      }

      const { data: existingRows, error: existingErr } = await supabase
        .from('recipe_inventory_items')
        .select('id,ingredient_name,quantity')
        .eq('tenant_id', userRow.tenant_id)
        .eq('user_id', userId)
        .limit(400);
      if (existingErr) throw existingErr;

      const existingByName = new Map(
        (existingRows ?? []).map((row) => [row.ingredient_name.trim().toLowerCase(), row]),
      );

      for (const item of suggestedItems) {
        const ingredientName = (item.canonical_name || item.display_name || '').trim();
        if (!ingredientName) continue;
        const key = ingredientName.toLowerCase();
        const quantityValue = item.quantity === null ? null : `${item.quantity} ${item.unit}`.trim();
        const existing = existingByName.get(key);

        if (existing?.id) {
          if (!existing.quantity || existing.quantity.trim().length === 0) {
            const { error: updateErr } = await supabase
              .from('recipe_inventory_items')
              .update({ quantity: quantityValue })
              .eq('id', existing.id);
            if (updateErr) throw updateErr;
          }
          continue;
        }

        const { error: insertErr } = await supabase.from('recipe_inventory_items').insert({
          tenant_id: userRow.tenant_id,
          user_id: userId,
          ingredient_name: ingredientName,
          quantity: quantityValue,
        });
        if (insertErr) throw insertErr;
      }

      await load();
      setError('Inventario sugerido aplicado al inventario real.');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No se pudo aplicar inventario sugerido.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="texture-paper min-h-screen bg-[#FAF6F1] px-4 py-6 text-[#241A14] md:px-6">
      <section className="mx-auto w-full max-w-4xl rounded-3xl border border-[#E8DDD2] bg-white/80 p-5 premium-shadow">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Inventario de ingredientes</h1>
            <p className="text-[#6B5A50]">Gestioná tu inventario para mejorar recetas y menús.</p>
          </div>
          <Link href="/app" className="text-sm font-semibold text-[#A55412]">Volver</Link>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void applySuggestedInventory()}
            disabled={working || loading || suggestedCount === 0}
            className="rounded-xl border border-[#E8DDD2] bg-white px-3 py-2 text-sm font-semibold text-[#6B5A50] disabled:opacity-60"
          >
            Aplicar sugerido del menú
          </button>
          <span className="text-xs text-[#6B5A50]">Sugeridos disponibles: {suggestedCount}</span>
        </div>

        <form onSubmit={onSubmit} className="grid gap-2 md:grid-cols-[1fr_220px_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ingrediente" className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none" />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Cantidad" className="h-11 rounded-xl border border-[#E8DDD2] bg-white px-3 outline-none" />
          <button type="submit" disabled={working} className="h-11 rounded-xl bg-[#C56A1A] px-4 font-semibold text-white disabled:opacity-60">
            {working ? 'Guardando...' : 'Agregar'}
          </button>
        </form>

        {error ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm text-[#6B5A50]">Cargando...</p> : null}

        <ul className="mt-4 grid gap-2">
          {rows.map((item) => (
            <li key={item.id} className="flex items-center justify-between rounded-xl border border-[#E8DDD2] bg-white/70 px-3 py-2 text-sm">
              <span className="font-medium">{item.ingredient_name}</span>
              <span className="text-[#6B5A50]">{item.quantity ?? 'Sin cantidad'}</span>
            </li>
          ))}
          {!loading && rows.length === 0 ? <li className="text-sm text-[#6B5A50]">Aún no tienes ingredientes cargados.</li> : null}
        </ul>
      </section>
    </main>
  );
}
