import type { SmartShoppingList } from '@/lib/inventory/meal-plan-projection';

type Props = {
  shopping: SmartShoppingList;
};

export function SmartShoppingSection(props: Props) {
  return (
    <article className="rounded-2xl border border-[#E8DDD2] bg-white/85 p-3 sm:p-4 xl:p-5">
      <h3 className="text-lg font-semibold text-[#241A14]">Lista inteligente de compras</h3>
      <p className="mt-1 text-sm text-[#6B5A50]">Asistente de compras por categoría, con contexto de recetas.</p>

      <div className="mt-3 space-y-3">
        {props.shopping.groups.map((group) => (
          <section key={group.category} className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3">
            <p className="text-sm font-semibold text-[#241A14]">{group.category}</p>
            <ul className="mt-2 space-y-2">
              {group.items.map((item) => (
                <li key={`${group.category}-${item.normalizedName}`} className="rounded-lg border border-[#E8DDD2] bg-[#FAF6F1] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[#241A14]">{item.ingredientName}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        item.status === 'buy'
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : item.status === 'review'
                            ? 'border-[#6B5A50]/30 bg-[#6B5A50]/10 text-[#6B5A50]'
                            : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      }`}
                    >
                      {item.status === 'buy' ? 'Comprar' : item.status === 'review' ? 'Revisar' : 'Cubierto'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#6B5A50]">
                    {item.quantityToBuy === null ? 'Cantidad: revisar manualmente' : `Cantidad: ${item.quantityToBuy} ${item.unit}`}
                    {item.estimatedCost !== null ? ` · ~$${item.estimatedCost.toFixed(2)}` : ''}
                  </p>
                  {item.usedInRecipes.length > 0 ? (
                    <p className="mt-1 line-clamp-2 text-[11px] text-[#8C7A6D]">Usado en: {item.usedInRecipes.join(', ')}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {props.shopping.groups.length === 0 ? (
          <section className="rounded-xl border border-[#E8DDD2] bg-white/80 p-3 text-sm text-[#6B5A50]">
            No hay faltantes consolidados para comprar.
          </section>
        ) : null}
      </div>
    </article>
  );
}
