import { PoolClient } from 'pg';
import { query, transaction, mapSingleRow } from '@/lib/db';

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  requested_ip_hash: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface CreatePasswordResetTokenInput {
  userId: string;
  tokenHash: string;
  requestedIpHash: string | null;
  expiresAt: Date;
}

export async function invalidateActivePasswordResetTokens(
  client: PoolClient,
  userId: string
): Promise<void> {
  await client.query(
    `update public.password_reset_tokens
     set used_at = now()
     where user_id = $1 and used_at is null`,
    [userId]
  );
}

export async function createPasswordResetToken(
  input: CreatePasswordResetTokenInput
): Promise<PasswordResetTokenRow> {
  return transaction(async (client) => {
    await invalidateActivePasswordResetTokens(client, input.userId);

    const result = await client.query<PasswordResetTokenRow>(
      `insert into public.password_reset_tokens
       (user_id, token_hash, requested_ip_hash, expires_at)
       values ($1, $2, $3, $4)
       returning *`,
      [input.userId, input.tokenHash, input.requestedIpHash, input.expiresAt.toISOString()]
    );

    const row = mapSingleRow(result);
    if (!row) {
      throw new Error('Failed to create password reset token');
    }
    return row;
  });
}

export async function findActivePasswordResetToken(
  tokenHash: string
): Promise<PasswordResetTokenRow | null> {
  const result = await query<PasswordResetTokenRow>(
    `select * from public.password_reset_tokens
     where token_hash = $1
       and used_at is null
       and expires_at > now()
     limit 1`,
    [tokenHash]
  );
  return mapSingleRow(result);
}

export async function markPasswordResetTokenUsed(tokenId: string): Promise<void> {
  await query(
    `update public.password_reset_tokens
     set used_at = now()
     where id = $1 and used_at is null`,
    [tokenId]
  );
}

export async function consumePasswordResetToken<T>(
  tokenHash: string,
  callback: (client: PoolClient, token: PasswordResetTokenRow) => Promise<T>
): Promise<T | null> {
  return transaction(async (client) => {
    const result = await client.query<PasswordResetTokenRow>(
      `select * from public.password_reset_tokens
       where token_hash = $1
         and used_at is null
         and expires_at > now()
       for update
       limit 1`,
      [tokenHash]
    );

    const token = mapSingleRow(result);
    if (!token) {
      return null;
    }

    const output = await callback(client, token);
    await client.query('update public.password_reset_tokens set used_at = now() where id = $1', [
      token.id,
    ]);
    return output;
  });
}
