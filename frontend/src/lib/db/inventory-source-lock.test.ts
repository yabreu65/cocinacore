import { describe, expect, it, vi } from 'vitest';
import { lockInventorySourceTenant } from './inventory-source-lock';

describe('lockInventorySourceTenant', () => {
  it('uses a namespaced canonical tenant UUID key and no user/global key', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const otherQuery = vi.fn().mockResolvedValue({ rows: [] });

    await lockInventorySourceTenant({ query }, 'A1B2C3D4-E5F6-4789-ABCD-0123456789AB');
    await lockInventorySourceTenant({ query: otherQuery }, 'b1b2c3d4-e5f6-4789-abcd-0123456789ab');

    expect(query).toHaveBeenCalledExactlyOnceWith(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['cocinacore:inventory-source:v1:a1b2c3d4-e5f6-4789-abcd-0123456789ab']
    );
    expect(otherQuery.mock.calls[0]?.[1]).toEqual([
      'cocinacore:inventory-source:v1:b1b2c3d4-e5f6-4789-abcd-0123456789ab',
    ]);
    expect(query.mock.calls[0]?.[1]).not.toEqual(otherQuery.mock.calls[0]?.[1]);
  });

  it('rejects a non-UUID tenant before attempting to lock', async () => {
    const query = vi.fn();

    await expect(lockInventorySourceTenant({ query }, 'tenant-1')).rejects.toThrow(
      'Invalid inventory source tenant ID.'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('propagates lock failures so callers cannot continue to source reads or writes', async () => {
    const failure = new Error('lock unavailable');
    const query = vi.fn().mockRejectedValue(failure);

    await expect(
      lockInventorySourceTenant({ query }, 'a1b2c3d4-e5f6-4789-abcd-0123456789ab')
    ).rejects.toBe(failure);
  });
});
