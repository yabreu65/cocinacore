import { describe, expect, it } from 'vitest';
import {
  authenticateProductionUser,
  type ProductionAuthTransport,
} from './production-e2e-auth';

const credentials = {
  email: 'synthetic@example.test',
  password: 'synthetic-password',
  expectedUserId: 'synthetic-user',
  expectedTenantId: 'synthetic-tenant',
};

function transport(loginOK: boolean, sessionPayload: unknown = {
  user: { id: credentials.expectedUserId, tenant: { tenantId: credentials.expectedTenantId } },
}, sessionOK = true) {
  const paths: string[] = [];
  let sessionReads = 0;
  const api: ProductionAuthTransport = {
    async post(path, options) {
      void options;
      paths.push(path);
      return { ok: () => loginOK };
    },
    async get(path) {
      paths.push(path);
      sessionReads += 1;
      return { ok: () => sessionOK, json: async () => sessionPayload };
    },
  };
  return { api, paths, get sessionReads() { return sessionReads; } };
}

describe('production E2E authentication', () => {
  it('logs in then verifies and returns only the expected identity', async () => {
    const mock = transport(true);
    await expect(authenticateProductionUser(mock.api, credentials)).resolves.toEqual({
      userId: credentials.expectedUserId,
      tenantId: credentials.expectedTenantId,
    });
    expect(mock.paths).toEqual(['/api/auth/login', '/api/auth/session']);
  });

  it('fails safely on login failure without requesting a session', async () => {
    const mock = transport(false);
    await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow('Production authentication failed.');
    expect(mock.paths).toEqual(['/api/auth/login']);
    expect(mock.sessionReads).toBe(0);
  });

  it('fails when the authenticated session is unavailable', async () => {
    const mock = transport(true, undefined, false);
    await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow('Production session verification failed.');
    expect(mock.paths).toEqual(['/api/auth/login', '/api/auth/session']);
  });

  it.each([null, {}, { user: null }, { user: { id: 3, tenant: { tenantId: 'synthetic-tenant' } } }])(
    'rejects malformed session identity', async (payload) => {
      const mock = transport(true, payload);
      await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow();
    },
  );

  it('rejects a missing tenant', async () => {
    const mock = transport(true, { user: { id: credentials.expectedUserId, tenant: null } });
    await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow();
  });

  it('rejects a wrong user ID', async () => {
    const mock = transport(true, { user: { id: 'other-user', tenant: { tenantId: credentials.expectedTenantId } } });
    await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow();
  });

  it('rejects a wrong tenant ID', async () => {
    const mock = transport(true, { user: { id: credentials.expectedUserId, tenant: { tenantId: 'other-tenant' } } });
    await expect(authenticateProductionUser(mock.api, credentials)).rejects.toThrow();
  });

  it('never requests any path other than login and session', async () => {
    const mock = transport(true);
    await authenticateProductionUser(mock.api, credentials);
    expect(mock.paths).not.toContain('/api/auth/signup');
    expect(mock.paths.every((path) => ['/api/auth/login', '/api/auth/session'].includes(path))).toBe(true);
  });
});
