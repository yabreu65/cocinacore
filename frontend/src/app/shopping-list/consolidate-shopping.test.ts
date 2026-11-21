import { describe, expect, it } from 'vitest';
import { consolidateShoppingItems } from './consolidate-shopping';
import type { ShoppingItem } from './ShoppingTransferControls';

function row(
  id: string,
  name: string,
  quantity: string | null,
  status: ShoppingItem['status'] = 'pending'
): ShoppingItem {
  return {
    id,
    ingredient_name: name,
    quantity,
    status,
    source: 'meal-plan:test',
    transfer_inventory_item_id: null,
    transferred_at: null,
    created_at: '2026-11-21T00:00:00.000Z',
    updated_at: '2026-11-21T00:00:00.000Z',
  };
}

describe('safe grocery consolidation with practical purchases', () => {
  it.each([
    [11, 5, '16 unidades'],
    [11, 15, '26 unidades'],
    [23, 3, '26 unidades'],
  ])('combines singular/plural eggs %s + %s into one 30-egg carton', (left, right, required) => {
    const grouped = consolidateShoppingItems([
      row('1', 'Huevo', `${left} unidad`),
      row('2', 'Huevos', `${right} unidad`),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      name: 'Huevos',
      required,
      purchase: '1 cartón de 30 huevos · 30 unidades',
      needsReview: false,
    });
    expect(grouped[0].rows.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('rounds egg cartons up without silently changing required count', () => {
    expect(consolidateShoppingItems([row('1', 'Huevos', '31 unidad')])[0]).toMatchObject({
      required: '31 unidades',
      purchase: '2 cartones de 30 huevos · 60 unidades',
    });
  });

  it.each([
    ['700 g', '700 g', '1 paquete de 1 kg · 1000 g'],
    ['1.3 kg', '1300 g', '2 paquetes de 1 kg · 2000 g'],
  ])('rounds dry rice from %s to whole kg packs', (amount, required, purchase) => {
    expect(consolidateShoppingItems([row('1', 'Arroz blanco', amount)])[0]).toMatchObject({
      required,
      purchase,
    });
  });

  it('adds g and kg for the same ingredient and preserves source data', () => {
    const source = [row('a', 'Arroz basmati', '700 g'), row('b', 'Arroz basmati', '0.5 kg')];
    const grouped = consolidateShoppingItems(source)[0];
    expect(grouped).toMatchObject({ required: '1200 g', purchase: '2 paquetes de 1 kg · 2000 g' });
    expect(source.map((s) => s.quantity)).toEqual(['700 g', '0.5 kg']);
  });

  it('does not combine different types of rice or cooked with raw rice', () => {
    const grouped = consolidateShoppingItems([
      row('1', 'Arroz blanco', '700 g'),
      row('2', 'Arroz blanco cocido', '500 g'),
      row('3', 'Arroz jazmín', '250 g'),
    ]);
    expect(grouped.map((p) => p.name)).toEqual([
      'Arroz blanco',
      'Arroz blanco cocido',
      'Arroz jazmín',
    ]);
    expect(grouped[1].purchase).toBe('500 g (presentación a elegir)');
  });

  it('groups compatible fresh ingredients, but not dried seasoning', () => {
    const grouped = consolidateShoppingItems([
      row('1', 'Champiñones', '500 g'),
      row('2', 'Champiñones frescos', '700 g'),
      row('3', 'Cilantro', '20 g'),
      row('4', 'Cilantro fresco', '75 g'),
      row('5', 'Cilantro en polvo', '1 cucharadita'),
    ]);
    expect(grouped).toHaveLength(3);
    expect(grouped[0]).toMatchObject({ name: 'Champiñones frescos', required: '1200 g' });
    expect(grouped[1]).toMatchObject({ name: 'Cilantro fresco', required: '95 g' });
    expect(grouped[2].name).toBe('Cilantro en polvo');
  });

  it('refuses arbitrary unit/weight conversion and does not propose a fictitious package', () => {
    const grouped = consolidateShoppingItems([
      row('1', 'Berenjena', '2 unidad'),
      row('2', 'Berenjenas', '500 g'),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      required: '2 unidades + 500 g (revisar equivalencias)',
      purchase: null,
      needsReview: true,
    });
  });

  it('avoids guessing for missing or unparseable quantities', () => {
    expect(
      consolidateShoppingItems([
        row('1', 'Arroz blanco', '700 g'),
        row('2', 'Arroz blanco', null),
      ])[0]
    ).toMatchObject({
      required: '700 g (revisar equivalencias)',
      purchase: null,
      needsReview: true,
    });
    expect(consolidateShoppingItems([row('3', 'Huevos', 'muchos')])[0].purchase).toBeNull();
  });

  it('does not merge status, substitute alternatives or grated vs block cheeses', () => {
    const grouped = consolidateShoppingItems([
      row('1', 'Huevo', '11 unidad'),
      row('2', 'Huevos', '5 unidad', 'purchased'),
      row('3', 'Huevos (o sustituto vegano)', '2 unidad'),
      row('4', 'Parmigiano rallado', '50 g'),
      row('5', 'Queso Parmigiano rallado', '175 g'),
      row('6', 'Queso Parmigiano-Reggiano', '100 g'),
    ]);
    expect(grouped.map((x) => x.name)).toEqual([
      'Huevos',
      'Huevos',
      'Huevos (o sustituto vegano)',
      'Parmesano rallado',
      'Queso Parmigiano-Reggiano',
    ]);
    expect(grouped[3].required).toBe('225 g');
  });

  it('rounds discrete produce up but never fabricates spoon packages', () => {
    expect(consolidateShoppingItems([row('1', 'Cebolla morada', '0.5 unidad')])[0]).toMatchObject({
      required: '0.5 unidades',
      purchase: '1 unidad',
    });
    expect(consolidateShoppingItems([row('2', 'Aceite de oliva', '2 cucharada')])[0]).toMatchObject(
      {
        required: '2 cucharada',
        purchase: null,
      }
    );
  });
});
