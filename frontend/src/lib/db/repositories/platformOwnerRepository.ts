import { scopedTransaction } from '@/lib/db';
import type { PlatformOwnerRow } from '@/lib/db/types';
import type { AuthUser } from '@/lib/auth/types';

export async function findPlatformOwnerForSession(
  user: AuthUser
): Promise<Pick<PlatformOwnerRow, 'user_id'> | null> {
  const tenantId = user.tenant?.tenantId;
  if (!tenantId) return null;

  return scopedTransaction({ tenantId, userId: user.id }, async (client) => {
    const result = await client.query<Pick<PlatformOwnerRow, 'user_id'>>(
      'select user_id from public.platform_owners where user_id = $1 limit 1',
      [user.id]
    );
    return result.rows[0] ?? null;
  });
}

export async function isPlatformOwner(user: AuthUser): Promise<boolean> {
  const row = await findPlatformOwnerForSession(user);
  return row !== null;
}
