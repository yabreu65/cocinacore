import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ShoppingTransferControls, type ShoppingItem } from './ShoppingTransferControls';

const item: ShoppingItem = {
  id: 'shopping-row-1',
  source: 'manual',
  ingredient_name: 'Lentejas',
  quantity: '2 kg',
  status: 'purchased',
  transfer_inventory_item_id: null,
  transferred_at: null,
  created_at: '2025-01-01T10:00:00.000Z',
  updated_at: '2025-01-01T10:00:00.000Z',
};

describe('ShoppingTransferControls', () => {
  it('shows an explicit transfer action only for purchased, not-yet-transferred rows', () => {
    const onTransfer = vi.fn();
    const purchasedMarkup = renderToStaticMarkup(
      createElement(ShoppingTransferControls, { item, busy: false, onTransfer })
    );
    const pendingMarkup = renderToStaticMarkup(
      createElement(ShoppingTransferControls, {
        item: { ...item, status: 'pending' },
        busy: false,
        onTransfer,
      })
    );
    const transferredMarkup = renderToStaticMarkup(
      createElement(ShoppingTransferControls, {
        item: { ...item, transferred_at: '2025-01-02T10:00:00.000Z' },
        busy: false,
        onTransfer,
      })
    );

    expect(purchasedMarkup).toContain('Agregar al inventario');
    expect(purchasedMarkup).toContain('type="button"');
    expect(pendingMarkup).not.toContain('Agregar al inventario');
    expect(transferredMarkup).toContain('Agregado al inventario');
    expect(transferredMarkup).not.toContain('Agregar al inventario');
    expect(onTransfer).not.toHaveBeenCalled();
  });
});
