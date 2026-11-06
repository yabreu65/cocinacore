import { Pool } from 'pg';
import { validateE2ETargets } from './database-target';

interface SignupResponse {
  user?: {
    id?: unknown;
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for isolated E2E setup.`);
  return value;
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
}

export default async function globalSetup(): Promise<void> {
  if (
    process.env.COCINACORE_SEPARATED_DB_LANES_ENABLED !== 'true' ||
    process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED !== 'true'
  ) {
    throw new Error('E2E requires separated database lanes and the signup bootstrap capability.');
  }

  const targets = validateE2ETargets(process.env);
  const email = requiredEnvironment('E2E_USER_EMAIL');
  const password = requiredEnvironment('E2E_USER_PASSWORD');
  const appPort = process.env.E2E_APP_PORT ?? '4320';
  if (!/^\d{1,5}$/.test(appPort) || Number(appPort) < 1 || Number(appPort) > 65535) {
    throw new Error('E2E_APP_PORT must be an integer from 1 to 65535.');
  }

  const runtimePool = new Pool({ connectionString: targets.appDatabaseUrl, max: 1 });
  const fixturePool = new Pool({ connectionString: targets.databaseUrl, max: 1 });
  try {
    const runtimeIdentity = await runtimePool.query<{
      role_name: string;
      is_superuser: boolean;
      bypasses_rls: boolean;
    }>(`
      select current_user::text as role_name,
             role.rolsuper as is_superuser,
             role.rolbypassrls as bypasses_rls
        from pg_catalog.pg_roles role
       where role.rolname = current_user
    `);
    const identity = runtimeIdentity.rows[0];
    if (
      identity?.role_name !== 'cocinacore_runtime_rls' ||
      identity.is_superuser ||
      identity.bypasses_rls
    ) {
      throw new Error('E2E application database identity is not the restricted runtime role.');
    }

    const baseUrl = `http://127.0.0.1:${appPort}`;
    const signup = await postJson(`${baseUrl}/api/auth/signup`, {
      email,
      password,
      confirmPassword: password,
      fullName: 'CI E2E Owner',
      termsAccepted: true,
    });
    const sessionCookie = signup.headers.get('set-cookie')?.split(';', 1)[0];
    if (!signup.ok || !sessionCookie) {
      throw new Error(`HTTP signup bootstrap failed (${signup.status}).`);
    }
    const signupPayload = (await signup.json()) as SignupResponse;
    const userId = signupPayload.user?.id;
    if (
      typeof userId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ) {
      throw new Error('HTTP signup bootstrap returned no valid user identity.');
    }

    const profile = await fetch(`${baseUrl}/api/profile`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: sessionCookie,
      },
      body: JSON.stringify({
        level: 'Intermedio',
        availableTimeMinutes: 30,
        onboardingCompleted: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!profile.ok) {
      throw new Error(`HTTP profile onboarding bootstrap failed (${profile.status}).`);
    }

    await fixturePool.query(
      `insert into public.platform_owners (user_id, requires_manual_review)
       values ($1, false)
       on conflict (user_id) do update set requires_manual_review = false`,
      [userId]
    );

    const login = await postJson(`${baseUrl}/api/auth/login`, { email, password });
    if (!login.ok || !login.headers.get('set-cookie')) {
      throw new Error(`HTTP login validation failed (${login.status}).`);
    }
  } finally {
    await Promise.all([runtimePool.end(), fixturePool.end()]);
  }

  console.log('E2E signup/login and restricted application role verified.');
}
