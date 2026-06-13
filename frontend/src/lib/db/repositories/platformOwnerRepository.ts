import { query, mapSingleRow } from '@/lib/db';
import { PlatformOwnerRow } from '@/lib/db/types';

export async function findPlatformOwnerByUserId(userId: string): Promise<PlatformOwnerRow | null> {
  const result = await query<PlatformOwnerRow>(
    'select * from public.platform_owners where user_id = $1 limit 1',
    [userId]
  );

  return mapSingleRow(result);
}

export async function isPlatformOwner(userId: string): Promise<boolean> {
  const row = await findPlatformOwnerByUserId(userId);
  return row !== null;
}
