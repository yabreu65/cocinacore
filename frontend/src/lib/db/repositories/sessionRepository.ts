import { query, mapSingleRow } from '@/lib/db';
import { SessionRow } from '@/lib/db/types';

export async function hashSessionToken(token: string): Promise<string> {
  // Use Web Crypto API for Edge compatibility.
  if (typeof crypto !== 'undefined' && 'subtle' in crypto) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  // Fallback for Node.js script contexts (bootstrap, migrations) where Web Crypto is not available.
  const cryptoModule = await import('crypto');
  return cryptoModule.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<SessionRow> {
  const result = await query<SessionRow>(
    `insert into public.sessions (user_id, token_hash, expires_at)
     values ($1, $2, $3)
     returning *`,
    [userId, tokenHash, expiresAt.toISOString()]
  );

  const session = mapSingleRow(result);
  if (!session) {
    throw new Error('Failed to create session');
  }

  return session;
}

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionRow | null> {
  const result = await query<SessionRow>(
    `select * from public.sessions
     where token_hash = $1 and expires_at > now()
     limit 1`,
    [tokenHash]
  );
  return mapSingleRow(result);
}

export async function touchSessionLastSeen(tokenHash: string): Promise<void> {
  await query('update public.sessions set last_seen_at = now() where token_hash = $1', [
    tokenHash,
  ]);
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await query('delete from public.sessions where token_hash = $1', [tokenHash]);
}

export async function deleteSessionsByUserId(userId: string): Promise<void> {
  await query('delete from public.sessions where user_id = $1', [userId]);
}

export async function deleteExpiredSessions(): Promise<void> {
  await query('delete from public.sessions where expires_at <= now()');
}
