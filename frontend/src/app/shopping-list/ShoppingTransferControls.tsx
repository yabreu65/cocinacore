import type { ReactNode } from 'react';

export type ShoppingItem = {
  id: string;
  source: string;
  ingredient_name: string;
  quantity: string | null;
  status: 'pending' | 'purchased';
  transfer_inventory_item_id: string | null;
  transferred_at: string | null;
  created_at: string;
  updated_at: string;
};

interface ShoppingTransferControlsProps {
  item: ShoppingItem;
  busy: boolean;
  onTransfer: () => void;
}

export function ShoppingTransferControls({
  item,
  busy,
  onTransfer,
}: ShoppingTransferControlsProps): ReactNode {
  if (item.transfer_inventory_item_id || item.transferred_at) {
    return (
      <p role="status" className="text-sm font-semibold text-bistro-success">
        Agregado al inventario
      </p>
    );
  }
  if (item.status !== 'purchased') return null;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onTransfer}
      className="min-h-11 min-w-0 max-w-full rounded-xl border border-bistro-success/30 px-3 text-left text-sm font-semibold text-bistro-success whitespace-normal break-words hover:bg-bistro-success/10 disabled:cursor-wait disabled:opacity-60"
    >
      {busy ? 'Agregando al inventario...' : 'Agregar al inventario'}
    </button>
  );
}
