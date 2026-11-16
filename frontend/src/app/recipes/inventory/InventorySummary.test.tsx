import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { InventorySummary } from './InventorySummary';
import { summarizeInventory, type OverviewItem } from '@/lib/inventory/inventory-overview';
const today = new Date(2026, 10, 12, 12);
const item: OverviewItem = {
  ingredient_name: 'Harina',
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
describe('Bistró inventory summary', () => {
  it('uses semantic colors, coverage and explicit currency without a misleading complete total', () => {
    const summary = summarizeInventory([item, { ...item, price_currency: 'USD' }], 'COP', today);
    const html = renderToStaticMarkup(
      <InventorySummary summary={summary} loading={false} dataReady />
    );
    expect(html).toContain('bg-bistro-action-secondary');
    expect(html).toContain('COP 2000.00');
    expect(html).toContain('1 de 2 con valor calculable');
    expect(html).toContain('1 excluidos');
    expect(html).not.toContain('USD 2000');
  });
  it('does not render a known amount when the inventory cannot be verified', () => {
    const summary = summarizeInventory([item], 'COP', today);
    for (const loading of [true, false]) {
      const html = renderToStaticMarkup(
        <InventorySummary summary={summary} loading={loading} dataReady={false} />
      );
      expect(html).toContain('Información no disponible');
      expect(html).not.toContain('COP 2000.00');
      expect(html).not.toContain('1 de 1 con valor calculable');
    }
  });
  it('distinguishes missing currency from known zero', () => {
    const missing = renderToStaticMarkup(
      <InventorySummary
        summary={summarizeInventory([item], null, today)}
        loading={false}
        dataReady
      />
    );
    expect(missing).toContain('Configura la moneda de trabajo');
    expect(missing).not.toContain('0.00');
    const zero = renderToStaticMarkup(
      <InventorySummary
        summary={summarizeInventory([{ ...item, quantity: '0' }], 'COP', today)}
        loading={false}
        dataReady
      />
    );
    expect(zero).toContain('COP 0.00');
  });
});
