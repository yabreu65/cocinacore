import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { NextRequest } from 'next/server';
import { hashPassword } from '@/lib/auth/password';
import { resolveSessionToken } from '@/lib/auth/session';
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true, limit: 10, remaining: 9, resetAt: 1 }),
}));
const emailMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/resend', () => ({
  getAppPublicUrl: () => 'https://app.example.test',
  sendPasswordResetEmail: emailMock,
}));
const wrongRole = process.env.COCINACORE_SIGNUP_WRONG_ROLE_TEST === '1';
const enabled = process.env.COCINACORE_SIGNUP_BOOTSTRAP_TEST === '1' || wrongRole;
let admin: Pool;
const password = 'SecurePassword123!';
function req(email: string) {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      confirmPassword: password,
      fullName: 'Owner',
      termsAccepted: true,
    }),
  }) as NextRequest;
}
describe.skipIf(!enabled)('bootstrap signup HTTP with PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.SIGNUP_TEST_ADMIN_URL ?? '');
    const data = new URL(process.env.DATABASE_URL ?? '');
    const auth = new URL(process.env.AUTH_DATABASE_URL ?? '');
    if (
      url.hostname !== '127.0.0.1' ||
      url.pathname !== '/signup_real_disposable' ||
      data.host !== url.host ||
      auth.host !== url.host ||
      data.username !== 'cocinacore_runtime_rls' ||
      auth.username !== (wrongRole ? 'cocinacore_wrong_auth' : 'cocinacore_auth')
    )
      throw new Error('Disposable database required');
    admin = new Pool({ connectionString: url.toString() });
    const marker = await admin.query<{ marker: string }>(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    );
    if (marker.rows[0].marker !== 'cocinacore-signup-real-disposable')
      throw new Error('Disposable marker missing');
    process.env.AUTH_SECRET = 'disposable-signup-bootstrap-test';
    process.env.RESEND_API_KEY = 'disposable-test';
    process.env.EMAIL_FROM = 'test@example.test';
    process.env.APP_PUBLIC_URL = 'https://app.example.test';
    emailMock.mockResolvedValue(undefined);
    process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'true';
  });
  afterAll(async () => {
    delete process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED;
    await admin?.end();
  });
  it.skipIf(wrongRole)(
    'creates account, owner membership and session; login and duplicate work',
    async () => {
      const { POST } = await import('./route');
      const { POST: login } = await import('../login/route');
      const { POST: requestPasswordReset } = await import('../password-reset/request/route');
      const { POST: updatePassword } = await import('../password-reset/update/route');
      const email = `http-${randomUUID()}@example.test`;
      const response = await POST(req(email));
      expect(response.status).toBe(200);
      const token = response.headers.get('set-cookie')?.match(/cocinacore_session=([^;]+)/)?.[1];
      expect(token).toBeDefined();
      expect((await resolveSessionToken(decodeURIComponent(token!)))?.user.email).toBe(email);
      const rows = await admin.query<{ n: number }>(
        "select count(*)::int n from users u join tenants t on t.id=u.tenant_id join tenant_memberships m on m.user_id=u.id and m.tenant_id=t.id and m.role='owner' join sessions s on s.user_id=u.id where u.email=$1",
        [email]
      );
      expect(rows.rows[0].n).toBe(1);
      expect((await POST(req(email))).status).toBe(400);
      const logged = await login(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }) as NextRequest
      );
      expect(logged.status).toBe(200);

      const resetRequested = await requestPasswordReset(
        new Request('http://localhost/api/auth/password-reset/request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }) as NextRequest
      );
      expect(resetRequested.status).toBe(200);
      expect(await resetRequested.json()).toMatchObject({ ok: true });
      const resetEmail = emailMock.mock.calls.at(-1)?.[0] as { resetUrl: string } | undefined;
      const resetToken = new URL(
        resetEmail?.resetUrl ?? 'https://app.example.test'
      ).searchParams.get('token');
      expect(resetToken).toBeTruthy();

      const reset = await updatePassword(
        new Request('http://localhost/api/auth/password-reset/update', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: resetToken,
            password: 'ChangedPassword123!',
            confirmPassword: 'ChangedPassword123!',
          }),
        }) as NextRequest
      );
      expect(reset.status).toBe(200);
      expect((await resolveSessionToken(decodeURIComponent(token!)))?.user.email).toBeUndefined();
      expect(
        (
          await login(
            new Request('http://localhost/api/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, password }),
            }) as NextRequest
          )
        ).status
      ).toBe(401);
      expect(
        (
          await login(
            new Request('http://localhost/api/auth/login', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email, password: 'ChangedPassword123!' }),
            }) as NextRequest
          )
        ).status
      ).toBe(200);
    }
  );

  it.skipIf(wrongRole)(
    'serves signup maintenance over HTTP without writes while login remains available',
    async () => {
      const { POST: signupPost } = await import('./route');
      const { POST: loginPost } = await import('../login/route');
      const email = 'backup-a@example.test';
      const password = 'SecurePassword123!';
      const passwordHash = await hashPassword(password);
      const seededUser = await admin.query(
        'update public.users set password_hash=$1 where email=$2',
        [passwordHash, email]
      );
      expect(seededUser.rowCount).toBe(1);

      const server = createServer(async (incoming, outgoing) => {
        try {
          const bodyChunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            incoming.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
            incoming.on('end', resolve);
            incoming.on('error', reject);
          });
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) headers.set(name, value.join(', '));
            else if (value !== undefined) headers.set(name, value);
          }
          const url = new URL(incoming.url ?? '/', `http://${incoming.headers.host}`);
          const webRequest = new Request(url, {
            method: incoming.method ?? 'POST',
            headers,
            body: Buffer.concat(bodyChunks).toString('utf8'),
          }) as NextRequest;
          const result =
            url.pathname === '/api/auth/signup'
              ? await signupPost(webRequest)
              : url.pathname === '/api/auth/login'
                ? await loginPost(webRequest)
                : new Response(null, { status: 404 });
          outgoing.writeHead(result.status, Object.fromEntries(result.headers.entries()));
          outgoing.end(Buffer.from(await result.arrayBuffer()));
        } catch {
          outgoing.writeHead(500, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ error: 'Internal server error.' }));
        }
      });

      const address = await new Promise<{ port: number }>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const bound = server.address();
          if (!bound || typeof bound === 'string') {
            reject(new Error('HTTP test server did not bind a TCP port.'));
            return;
          }
          resolve({ port: bound.port });
        });
      });
      const maintenanceFlag = process.env.COCINACORE_SIGNUP_MAINTENANCE;
      const countRows = async () =>
        (
          await admin.query<{
            tenants: string;
            users: string;
            memberships: string;
            sessions: string;
          }>(
            `select (select count(*) from tenants) tenants, (select count(*) from users) users,
           (select count(*) from tenant_memberships) memberships, (select count(*) from sessions) sessions`
          )
        ).rows[0];

      try {
        process.env.COCINACORE_SIGNUP_MAINTENANCE = 'true';
        const before = await countRows();
        const signupResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/signup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: `blocked-${randomUUID()}@example.test`,
            password,
            confirmPassword: password,
            fullName: 'Blocked Owner',
            termsAccepted: true,
          }),
        });
        expect(signupResponse.status).toBe(503);
        expect(await signupResponse.json()).toEqual({
          error: 'El registro no está disponible temporalmente.',
        });
        expect(signupResponse.headers.get('set-cookie')).toBeNull();
        expect(await countRows()).toEqual(before);

        const loginResponse = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        expect(loginResponse.status).toBe(200);
        expect(loginResponse.headers.get('set-cookie')).toContain('cocinacore_session=');
      } finally {
        if (maintenanceFlag === undefined) delete process.env.COCINACORE_SIGNUP_MAINTENANCE;
        else process.env.COCINACORE_SIGNUP_MAINTENANCE = maintenanceFlag;
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
    }
  );
  it.skipIf(wrongRole).each(['tenant_memberships', 'sessions'])(
    'rolls back without cookie on %s failure',
    async (table) => {
      const { POST } = await import('./route');
      const email = `fail-${randomUUID()}@example.test`;
      await admin.query(
        `create function signup_http_fail() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$; create trigger signup_http_fail before insert on ${table} for each row execute function signup_http_fail()`
      );
      try {
        const response = await POST(req(email));
        expect(response.status).toBe(400);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect((await admin.query('select id from users where email=$1', [email])).rowCount).toBe(
          0
        );
        expect(
          (await admin.query('select id from tenants where name=$1', [`Tenant of ${email}`]))
            .rowCount
        ).toBe(0);
        expect(
          (
            await admin.query(
              'select 1 from tenant_memberships m join users u on u.id=m.user_id where u.email=$1',
              [email]
            )
          ).rowCount
        ).toBe(0);
        expect(
          (
            await admin.query(
              'select 1 from sessions s join users u on u.id=s.user_id where u.email=$1',
              [email]
            )
          ).rowCount
        ).toBe(0);
        const errorBody = await response.text();
        expect(errorBody).not.toContain('injected');
        expect(errorBody).not.toContain('password_hash');
        expect(errorBody).not.toContain('signup_new_account');
      } finally {
        await admin.query(
          `drop trigger signup_http_fail on ${table}; drop function signup_http_fail()`
        );
      }
    }
  );
  it.skipIf(wrongRole)(
    'rolls back and withholds the cookie when PostgreSQL rejects COMMIT',
    async () => {
      const { POST } = await import('./route');
      const email = `commit-fail-${randomUUID()}@example.test`;
      await admin.query(
        `create function signup_http_commit_fail() returns trigger language plpgsql as $$ begin raise exception 'injected commit failure'; end $$;
       create constraint trigger signup_http_commit_fail after insert on sessions deferrable initially deferred for each row execute function signup_http_commit_fail()`
      );
      try {
        const response = await POST(req(email));
        expect(response.status).toBe(400);
        expect(response.headers.get('set-cookie')).toBeNull();
        const body = await response.text();
        expect(body).not.toContain('injected commit failure');
        expect(body).not.toContain('signup_http_commit_fail');
        expect((await admin.query('select 1 from users where email=$1', [email])).rowCount).toBe(0);
        expect(
          (await admin.query('select 1 from tenants where name=$1', [`Tenant of ${email}`]))
            .rowCount
        ).toBe(0);
        expect(
          (
            await admin.query(
              'select 1 from tenant_memberships m join users u on u.id=m.user_id where u.email=$1',
              [email]
            )
          ).rowCount
        ).toBe(0);
        expect(
          (
            await admin.query(
              'select 1 from sessions s join users u on u.id=s.user_id where u.email=$1',
              [email]
            )
          ).rowCount
        ).toBe(0);
      } finally {
        await admin.query(
          'drop trigger signup_http_commit_fail on sessions; drop function signup_http_commit_fail()'
        );
      }
    }
  );
  it.skipIf(wrongRole)('fails closed when disabled while direct inserts are revoked', async () => {
    process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'false';
    try {
      const { POST } = await import('./route');
      const response = await POST(req(`legacy-denied-${randomUUID()}@example.test`));
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'true';
    }
  });
  it.skipIf(wrongRole)(
    'fails closed without fallback when function is absent or flag is invalid',
    async () => {
      const { POST } = await import('./route');
      await admin.query(
        'alter function public.signup_new_account(text,text,text,timestamptz,text) rename to signup_temporarily_unavailable'
      );
      try {
        const email = `missing-${randomUUID()}@example.test`;
        const response = await POST(req(email));
        expect(response.status).toBe(400);
        expect(response.headers.get('set-cookie')).toBeNull();
        expect((await admin.query('select id from users where email=$1', [email])).rowCount).toBe(
          0
        );
      } finally {
        await admin.query(
          'alter function public.signup_temporarily_unavailable(text,text,text,timestamptz,text) rename to signup_new_account'
        );
      }
      process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'invalid';
      try {
        expect((await POST(req(`invalid-${randomUUID()}@example.test`))).status).toBe(400);
      } finally {
        process.env.COCINACORE_SIGNUP_BOOTSTRAP_ENABLED = 'true';
      }
    }
  );

  it.skipIf(!wrongRole)(
    'fails closed when the configured auth connection uses the wrong SQL role',
    async () => {
      const { POST } = await import('./route');
      const email = `wrong-role-${randomUUID()}@example.test`;
      const privileges = await admin.query<{ execute: boolean; insert_tenant: boolean }>(
        `select has_function_privilege('cocinacore_wrong_auth', 'public.signup_new_account(text,text,text,timestamp with time zone,text)', 'EXECUTE') execute,
              has_table_privilege('cocinacore_wrong_auth', 'public.tenants', 'INSERT') insert_tenant`
      );
      expect(privileges.rows[0]).toEqual({ execute: false, insert_tenant: false });

      const response = await POST(req(email));
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
      const body = await response.text();
      expect(body).not.toContain('permission denied');
      expect(body).not.toContain('signup_new_account');
      expect((await admin.query('select 1 from users where email=$1', [email])).rowCount).toBe(0);
      expect(
        (await admin.query('select 1 from tenants where name=$1', [`Tenant of ${email}`])).rowCount
      ).toBe(0);
      expect(
        (
          await admin.query(
            'select 1 from tenant_memberships m join users u on u.id=m.user_id where u.email=$1',
            [email]
          )
        ).rowCount
      ).toBe(0);
      expect(
        (
          await admin.query(
            'select 1 from sessions s join users u on u.id=s.user_id where u.email=$1',
            [email]
          )
        ).rowCount
      ).toBe(0);
    }
  );
});
