import { describe, expect, it } from 'vitest';
import {
  EMPTY_INVENTORY_FILTERS,
  expiryState,
  filterInventory,
  summarizeInventory,
  type OverviewItem,
} from './inventory-overview';
const today = new Date(2026, 10, 12, 12);
const item: OverviewItem = {
  ingredient_name: 'Harina de trigo',
  quantity: '500',
  unit: 'g',
  category: 'Granos',
  expiration_date: null,
  low_stock_threshold: null,
  estimated_unit_price: '4000',
  price_currency: 'COP',
  price_reference_quantity: '1',
  price_reference_unit: 'kg',
};
describe('inventory overview', () => {
  it('searches normalized names, combines filters and preserves original rows', () => {
    const rows = [
      item,
      {
        ...item,
        ingredient_name: 'Limón',
        category: 'Frutas',
        quantity: '0',
        expiration_date: '2026-11-11',
      },
      { ...item, ingredient_name: 'Limonada', category: 'Despensa' },
    ];
    expect(
      filterInventory(
        rows,
        {
          ...EMPTY_INVENTORY_FILTERS,
          search: 'limon',
          category: 'Frutas',
          stock: 'agotado',
          expiry: 'expired',
        },
        today
      )
    ).toEqual([rows[1]]);
    expect(filterInventory(rows, EMPTY_INVENTORY_FILTERS, today)).toEqual(rows);
  });
  it.each([
    ['2026-11-11', 'expired'],
    ['2026-11-12', 'soon'],
    ['2026-11-17T00:00:00.000Z', 'soon'],
    ['2026-11-18', 'later'],
    [null, 'missing'],
    ['2026-02-30', 'invalid'],
  ] as const)('classifies %s', (date, state) => {
    expect(expiryState(date, today)).toBe(state);
  });
  it('counts alerts once and does not count unknown stock as exhausted', () => {
    const rows = [
      { ...item, quantity: '0', expiration_date: '2026-11-11' },
      { ...item, quantity: null },
      { ...item, quantity: '1', unit: '500 gramos' },
      { ...item, expiration_date: '2026-11-14' },
    ];
    expect(summarizeInventory(rows, 'COP', today)).toMatchObject({
      count: 4,
      alerts: 2,
      lowStock: 1,
      expiring: 2,
      needsReview: 2,
      valued: 2,
      unvalued: 2,
    });
  });
  it('excludes historical, foreign-currency and incompatible costs without claiming a complete total', () => {
    expect(
      summarizeInventory(
        [
          item,
          { ...item, price_currency: 'USD' },
          {
            ...item,
            price_currency: null,
            price_reference_quantity: null,
            price_reference_unit: null,
          },
          { ...item, unit: 'ml' },
        ],
        'COP',
        today
      )
    ).toMatchObject({ knownValue: '2000.00', valued: 1, unvalued: 3 });
    expect(summarizeInventory([item], null, today)).toMatchObject({
      knownValue: null,
      valued: 0,
      unvalued: 1,
    });
    expect(summarizeInventory([], 'COP', today)).toMatchObject({ knownValue: null, count: 0 });
  });
  it('sums unrounded exact values; distinguishes known zero from missing', () => {
    const third = {
      ...item,
      quantity: '1',
      unit: 'unidad',
      estimated_unit_price: '1',
      price_reference_quantity: '3',
      price_reference_unit: 'unidad',
    };
    expect(summarizeInventory([third, third, third], 'COP', today).knownValue).toBe('1.00');
    expect(summarizeInventory([{ ...item, quantity: '0' }], 'COP', today).knownValue).toBe('0.00');
  });
});
