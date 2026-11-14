import type { DbTransactionClient } from '@/lib/db/transaction-client';

const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCK_NAMESPACE = 'cocinacore:inventory-source:v1';

/** Serializes participating inventory-source reads and writes for one tenant only. */
export async function lockInventorySourceTenant(
  client: DbTransactionClient,
  tenantId: string
): Promise<void> {
  if (!TENANT_UUID.test(tenantId)) throw new Error('Invalid inventory source tenant ID.');
  const lockKey = `${LOCK_NAMESPACE}:${tenantId.toLowerCase()}`;
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [lockKey]);
}
