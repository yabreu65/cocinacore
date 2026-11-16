import { scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import { isInventoryCurrency, type InventoryCurrency } from '@/lib/inventory/inventory-price';

export type InventoryCurrencySettings = {
  currency: InventoryCurrency | null;
  canManageCurrency: boolean;
};

export async function readInventoryCurrencySettings(
  scope: AuthenticatedDbScope
): Promise<InventoryCurrencySettings | null> {
  return scopedTransaction(scope, async (client) => {
    const result = await client.query<{ currency_code: string | null; role: string }>(
      `select t.currency_code, m.role from public.tenants t
       join public.tenant_memberships m on m.tenant_id = t.id
       where t.id = $1 and m.user_id = $2`,
      [scope.tenantId, scope.userId]
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.currency_code !== null && !isInventoryCurrency(row.currency_code))
      throw new Error('Invalid persisted inventory currency');
    return {
      currency: row.currency_code,
      canManageCurrency: row.role === 'owner' || row.role === 'admin',
    };
  });
}

// Membership is checked in the write statement itself, in addition to RLS.
// Never trust the role from a request or cached session claim.
export async function updateInventoryCurrencySettings(
  scope: AuthenticatedDbScope,
  currency: InventoryCurrency
): Promise<InventoryCurrencySettings | null> {
  if (!isInventoryCurrency(currency)) throw new Error('Invalid inventory currency');
  return scopedTransaction(scope, async (client) => {
    const result = await client.query<{ currency_code: InventoryCurrency }>(
      `update public.tenants t set currency_code = $3
       where t.id = $1 and exists (
         select 1 from public.tenant_memberships m where m.tenant_id = t.id
           and m.user_id = $2 and m.role in ('owner', 'admin')
       ) returning currency_code`,
      [scope.tenantId, scope.userId, currency]
    );
    const row = result.rows[0];
    return row ? { currency: row.currency_code, canManageCurrency: true } : null;
  });
}
