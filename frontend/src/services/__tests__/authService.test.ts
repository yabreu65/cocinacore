import { describe, expect, it, vi } from 'vitest';

import {
  AuthService,
  PasswordCredentials,
  SupabaseAuthClientLike,
} from '../authService';
import { AuthProvider, AuthSession, AuthUser, Invitation, TenantRole } from '../types';

interface AuthHarness {
  service: AuthService;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signInWithOAuth: ReturnType<typeof vi.fn>;
}

function buildSession(provider: AuthProvider): AuthSession {
  const user: AuthUser = {
    id: `user-${provider}`,
    email: `${provider}@example.com`,
    provider,
  };

  return {
    accessToken: `access-${provider}`,
    refreshToken: `refresh-${provider}`,
    expiresAt: 1_781_000_000,
    user,
  };
}

function createClientStub(): AuthHarness {
  const passwordSession = buildSession('password');
  const signInWithPassword = vi.fn(async (credentials: PasswordCredentials) => ({
    data: { user: passwordSession.user, session: passwordSession },
    error: null,
    credentials,
  }));

  const signUpWithPassword = vi.fn(async (credentials: PasswordCredentials) => ({
    data: { user: passwordSession.user, session: null },
    error: null,
    credentials,
  }));

  const signInWithOAuth = vi.fn(async () => ({
    data: {
      provider: 'google' as const,
      url: 'https://supabase.example.com/oauth/google/start',
    },
    error: null,
  }));

  const from: SupabaseAuthClientLike['from'] = ((tableName: 'tenant_invitations' | 'tenants') => {
    if (tableName === 'tenant_invitations') {
      return {
        async insert() {
          return { data: null, error: null };
        },
        select() {
          return {
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: null, error: null };
            },
          };
        },
      };
    }

    return {
      select() {
        return {
          eq() {
            return {
              async maybeSingle() {
                return {
                  data: {
                    trial_started_at: new Date().toISOString(),
                    trial_ends_at: new Date().toISOString(),
                    trial_soft_blocked_at: null,
                  },
                  error: null,
                };
              },
            };
          },
        };
      },
    };
  }) as SupabaseAuthClientLike['from'];

  const client: SupabaseAuthClientLike = {
    auth: {
      signUpWithPassword,
      signInWithPassword,
      signInWithOAuth,
      async signOut() {
        return { data: null, error: null };
      },
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async getUser() {
        return { data: { user: null }, error: null };
      },
      mfa: {
        async listFactors() {
          return { data: { all: [] }, error: null };
        },
      },
    },
    async rpc() {
      return { data: '', error: null };
    },
    from,
  };

  return {
    service: new AuthService(client),
    signInWithPassword,
    signInWithOAuth,
  };
}

function buildInvitation(expiresAt: string): Invitation {
  return {
    id: 'inv-1',
    tenantId: 'tenant-1',
    email: 'member@example.com',
    invitedBy: 'owner-1',
    role: 'member',
    token: 'tok',
    status: 'pending',
    expiresAt,
    acceptedAt: null,
    acceptedBy: null,
    createdAt: new Date().toISOString(),
  };
}

describe('AuthService', () => {
  it('creates a session for email/password sign-in at runtime', async () => {
    const { service, signInWithPassword } = createClientStub();
    const credentials: PasswordCredentials = {
      email: 'owner@example.com',
      password: 'VerySecurePass123!',
    };

    const result = await service.signInWithPassword(credentials);

    expect(signInWithPassword).toHaveBeenCalledWith(credentials);
    expect(result.error).toBeNull();
    expect(result.data?.session.accessToken).toBe('access-password');
    expect(result.data?.user.provider).toBe('password');
  });

  it('starts google oauth flow and does not require extra in-app 2FA for privileged roles', async () => {
    const { service, signInWithOAuth } = createClientStub();

    const oauthResult = await service.signInWithGoogle({ redirectTo: 'http://localhost:3000/auth/callback' });
    const ownerNeedsExtraMfa = await service.requiresMfaEnrollment('owner', 'google');
    const adminNeedsExtraMfa = await service.requiresMfaEnrollment('admin', 'google');

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'http://localhost:3000/auth/callback' },
    });
    expect(oauthResult.error).toBeNull();
    expect(oauthResult.data?.provider).toBe('google');
    expect(ownerNeedsExtraMfa).toBe(false);
    expect(adminNeedsExtraMfa).toBe(false);
  });

  it('enforces mandatory 2FA enrollment for owner/admin password users', async () => {
    const { service } = createClientStub();
    const privilegedRoles: TenantRole[] = ['owner', 'admin'];

    for (const role of privilegedRoles) {
      await expect(service.requiresMfaEnrollment(role, 'password')).resolves.toBe(true);
    }

    await expect(service.requiresMfaEnrollment('member', 'password')).resolves.toBe(false);
    await expect(service.requiresMfaEnrollment('owner', 'google')).resolves.toBe(false);
  });

  it('treats invitations as valid when expiry is in the future and expired when in the past', () => {
    const { service } = createClientStub();
    const now = Date.parse('2026-05-22T12:00:00.000Z');
    const validInvitation = buildInvitation('2026-06-01T12:00:00.000Z');
    const expiredInvitation = buildInvitation('2026-05-01T12:00:00.000Z');

    expect(service.isInvitationExpired(validInvitation, now)).toBe(false);
    expect(service.isInvitationExpired(expiredInvitation, now)).toBe(true);
  });

  it('denies role-management capability for members while allowing owner/admin', () => {
    const { service } = createClientStub();

    expect(service.canManageTenantMembers('owner')).toBe(true);
    expect(service.canManageTenantMembers('admin')).toBe(true);
    expect(service.canManageTenantMembers('member')).toBe(false);
  });
});
