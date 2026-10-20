export interface ProductionAuthTransport {
  post(path: '/api/auth/login', options: { data: { email: string; password: string } }): Promise<{
    ok(): boolean;
  }>;
  get(path: '/api/auth/session'): Promise<{
    ok(): boolean;
    json(): Promise<unknown>;
  }>;
}

export interface ProductionAuthCredentials {
  email: string;
  password: string;
  expectedUserId: string;
  expectedTenantId: string;
}

export interface ProductionIdentity {
  userId: string;
  tenantId: string;
}

export async function authenticateProductionUser(
  transport: ProductionAuthTransport,
  credentials: ProductionAuthCredentials,
): Promise<ProductionIdentity> {
  const login = await transport.post('/api/auth/login', {
    data: { email: credentials.email, password: credentials.password },
  });
  if (!login.ok()) {
    throw new Error('Production authentication failed.');
  }

  const session = await transport.get('/api/auth/session');
  if (!session.ok()) {
    throw new Error('Production session verification failed.');
  }

  let payload: unknown;
  try {
    payload = await session.json();
  } catch {
    throw new Error('Production session response is invalid.');
  }

  if (typeof payload !== 'object' || payload === null || !('user' in payload)) {
    throw new Error('Production session identity is missing.');
  }
  const user = payload.user;
  if (typeof user !== 'object' || user === null || !('id' in user) || !('tenant' in user)) {
    throw new Error('Production session identity is invalid.');
  }
  const tenant = user.tenant;
  if (typeof user.id !== 'string' || typeof tenant !== 'object' || tenant === null ||
      !('tenantId' in tenant) || typeof tenant.tenantId !== 'string') {
    throw new Error('Production session identity is invalid.');
  }

  if (user.id !== credentials.expectedUserId || tenant.tenantId !== credentials.expectedTenantId) {
    throw new Error('Production session identity does not match the expected account.');
  }

  return { userId: user.id, tenantId: tenant.tenantId };
}
