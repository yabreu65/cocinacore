import type { PoolClient } from 'pg';

export function signupBootstrapEnabled(): boolean {
  const flag = process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED;
  if (flag === undefined || flag === 'false') return false;
  if (flag !== 'true') throw new Error('Invalid signup configuration.');
  if (process.env.COCINACORE_SEPARATE_AUTH_DB !== 'true')
    throw new Error('Invalid signup configuration.');

  try {
    const parseConnection = (raw: string | undefined) => {
      if (!raw?.trim()) throw new Error('Missing PostgreSQL connection URL.');
      const parsed = new URL(raw.trim());
      const username = decodeURIComponent(parsed.username);
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !username)
        throw new Error('Invalid PostgreSQL connection URL.');
      return username;
    };

    const auth = parseConnection(process.env.AUTH_DATABASE_URL);
    const runtime = parseConnection(process.env.DATABASE_URL);
    if (auth !== 'cocinacore_auth' || runtime === auth)
      throw new Error('Invalid auth SQL identity.');
  } catch {
    throw new Error('Invalid signup configuration.');
  }
  return true;
}

export async function createSignupBootstrap(
  client: PoolClient,
  input: {
    email: string;
    passwordHash: string;
    fullName: string;
    termsAcceptedAt: string;
    termsVersion: string;
  }
): Promise<{ userId: string; tenantId: string }> {
  const result = await client.query<{ user_id: string; tenant_id: string }>(
    'select user_id, tenant_id from public.signup_new_account($1,$2,$3,$4::timestamptz,$5)',
    [input.email, input.passwordHash, input.fullName, input.termsAcceptedAt, input.termsVersion]
  );
  const row = result.rows[0];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (result.rows.length !== 1 || !row || !uuid.test(row.user_id) || !uuid.test(row.tenant_id))
    throw new Error('Invalid signup result.');
  return { userId: row.user_id, tenantId: row.tenant_id };
}
