import { query, mapSingleRow } from '@/lib/db';
import { TenantRow, TenantType } from '@/lib/db/types';

interface CreateTenantInput {
  name: string;
  tenantType?: TenantType;
  trialDays?: number;
}

export async function findTenantById(id: string): Promise<TenantRow | null> {
  const result = await query<TenantRow>('select * from public.tenants where id = $1', [id]);
  return mapSingleRow(result);
}

export async function createTenant(input: CreateTenantInput = { name: '' }): Promise<TenantRow> {
  const name = input.name || 'New Tenant';
  const tenantType = input.tenantType ?? 'home';
  const trialDays = input.trialDays ?? 14;

  const result = await query<TenantRow>(
    `insert into public.tenants (name, tenant_type, trial_started_at, trial_ends_at)
     values ($1, $2, now(), now() + ($3 || ' days')::interval)
     returning *`,
    [name, tenantType, String(trialDays)]
  );

  const tenant = mapSingleRow(result);
  if (!tenant) {
    throw new Error('Failed to create tenant');
  }

  return tenant;
}

export async function updateTenant(
  id: string,
  input: Partial<Pick<TenantRow, 'name' | 'trial_started_at' | 'trial_ends_at' | 'trial_soft_blocked_at'>>
): Promise<TenantRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.trial_started_at !== undefined) {
    fields.push(`trial_started_at = $${paramIndex++}`);
    values.push(input.trial_started_at);
  }
  if (input.trial_ends_at !== undefined) {
    fields.push(`trial_ends_at = $${paramIndex++}`);
    values.push(input.trial_ends_at);
  }
  if (input.trial_soft_blocked_at !== undefined) {
    fields.push(`trial_soft_blocked_at = $${paramIndex++}`);
    values.push(input.trial_soft_blocked_at);
  }

  if (fields.length === 0) {
    return findTenantById(id);
  }

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await query<TenantRow>(
    `update public.tenants set ${fields.join(', ')} where id = $${paramIndex} returning *`,
    values
  );

  return mapSingleRow(result);
}
