import {
  AuthProvider,
  AuthSession,
  AuthUser,
  Invitation,
  InvitationCreateInput,
  InvitationListFilter,
  MfaAssuranceLevel,
  MfaFactor,
  TenantRole,
  TrialState,
} from './types';

export interface ExternalApiError {
  code?: string;
  message: string;
}

export interface ExternalApiResult<T> {
  data: T | null;
  error: ExternalApiError | null;
}

type Result<T> = Promise<ExternalApiResult<T>>;

export interface PasswordCredentials {
  email: string;
  password: string;
}

export interface OAuthSignInOptions {
  redirectTo?: string;
  scopes?: string;
}

export interface InvitationUpsertRow {
  id?: string;
  tenant_id: string;
  email: string;
  invited_by: string;
  role: TenantRole;
  invitation_token: string;
  status: Invitation['status'];
  expires_at: string;
  accepted_at?: string | null;
  accepted_by?: string | null;
  created_at?: string;
}

export interface TrialStateRow {
  trial_started_at: string;
  trial_ends_at: string;
  trial_soft_blocked_at: string | null;
}

export interface AuthApiLike {
  signUpWithPassword(credentials: PasswordCredentials): Result<{ user: AuthUser | null; session: AuthSession | null }>;
  signInWithPassword(credentials: PasswordCredentials): Result<{ user: AuthUser; session: AuthSession }>;
  signInWithOAuth(params: {
    provider: Exclude<AuthProvider, 'password'>;
    options?: OAuthSignInOptions;
  }): Result<{ provider: Exclude<AuthProvider, 'password'>; url: string }>;
  signOut(): Result<null>;
  getSession(): Result<{ session: AuthSession | null }>;
  getUser(): Result<{ user: AuthUser | null }>;
  mfa: {
    listFactors(): Result<{ all: MfaFactor[] }>;
  };
}

export interface SupabaseAuthClientLike {
  auth: AuthApiLike;
  rpc(functionName: 'accept_tenant_invitation', args: { p_invitation_token: string }): Result<string>;
  from(tableName: 'tenant_invitations'): {
    insert(values: InvitationUpsertRow[]): Result<null>;
    select(columns: string): InvitationSelectBuilder;
  };
  from(tableName: 'tenants'): {
    select(columns: string): {
      eq(column: 'id', value: string): {
        maybeSingle(): Result<TrialStateRow>;
      };
    };
  };
}

export interface InvitationSelectBuilder {
  eq(column: 'tenant_id' | 'status', value: string): InvitationSelectBuilder;
  maybeSingle(): Result<InvitationUpsertRow>;
}

function toInvitation(row: InvitationUpsertRow): Invitation {
  return {
    id: row.id ?? '',
    tenantId: row.tenant_id,
    email: row.email,
    invitedBy: row.invited_by,
    role: row.role,
    token: row.invitation_token,
    status: row.status,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at ?? null,
    acceptedBy: row.accepted_by ?? null,
    createdAt: row.created_at ?? row.expires_at,
  };
}

function toTrialState(row: TrialStateRow): TrialState {
  const now = Date.now();
  const endsAt = Date.parse(row.trial_ends_at);
  const expired = Number.isNaN(endsAt) ? false : endsAt < now;

  return {
    startedAt: row.trial_started_at,
    endsAt: row.trial_ends_at,
    softBlockedAt: row.trial_soft_blocked_at,
    isExpired: expired,
    canGenerate: !expired,
    canUploadPdf: !expired,
  };
}

export class AuthService {
  constructor(private readonly client: SupabaseAuthClientLike) {}

  isInvitationExpired(invitation: Pick<Invitation, 'expiresAt'>, nowMs: number = Date.now()): boolean {
    const expiresAtMs = Date.parse(invitation.expiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return true;
    }

    return expiresAtMs < nowMs;
  }

  canManageTenantMembers(role: TenantRole): boolean {
    return role === 'owner' || role === 'admin';
  }

  async signUpWithPassword(credentials: PasswordCredentials) {
    return this.client.auth.signUpWithPassword(credentials);
  }

  async signInWithPassword(credentials: PasswordCredentials) {
    return this.client.auth.signInWithPassword(credentials);
  }

  async signInWithGoogle(options?: OAuthSignInOptions) {
    return this.client.auth.signInWithOAuth({ provider: 'google', options });
  }

  async signOut() {
    return this.client.auth.signOut();
  }

  async getCurrentSession() {
    return this.client.auth.getSession();
  }

  async getCurrentUser() {
    return this.client.auth.getUser();
  }

  async listMfaFactors() {
    return this.client.auth.mfa.listFactors();
  }

  async requiresMfaEnrollment(role: TenantRole, provider: AuthProvider): Promise<boolean> {
    const privilegedRole = this.canManageTenantMembers(role);
    return privilegedRole && provider === 'password';
  }

  async getMfaAssuranceLevel(): Promise<MfaAssuranceLevel> {
    const factorsResult = await this.listMfaFactors();
    const factors = factorsResult.data?.all ?? [];

    if (factors.length === 0) {
      return 'aal1';
    }

    return factors.some((factor) => factor.status === 'verified') ? 'aal2' : 'aal1';
  }

  async createInvitation(input: InvitationCreateInput): Result<Invitation> {
    const invitationToken = `${input.tenantId}:${input.email}:${Date.now()}`;

    const result = await this.client.from('tenant_invitations').insert([
      {
        tenant_id: input.tenantId,
        email: input.email,
        invited_by: input.invitedBy,
        role: input.role,
        invitation_token: invitationToken,
        status: 'pending',
        expires_at: input.expiresAt,
      },
    ]);

    if (result.error) {
      return { data: null, error: result.error };
    }

    return {
      data: {
        id: '',
        tenantId: input.tenantId,
        email: input.email,
        invitedBy: input.invitedBy,
        role: input.role,
        token: invitationToken,
        status: 'pending',
        expiresAt: input.expiresAt,
        acceptedAt: null,
        acceptedBy: null,
        createdAt: new Date().toISOString(),
      },
      error: null,
    };
  }

  async getInvitationByTenant(filter: InvitationListFilter): Result<Invitation> {
    const result = await this.client
      .from('tenant_invitations')
      .select('*')
      .eq('tenant_id', filter.tenantId)
      .eq('status', filter.status ?? 'pending')
      .maybeSingle();

    if (!result.data) {
      return { data: null, error: result.error };
    }

    return { data: toInvitation(result.data), error: result.error };
  }

  async acceptInvitation(token: string): Result<string> {
    return this.client.rpc('accept_tenant_invitation', { p_invitation_token: token });
  }

  async getTrialState(tenantId: string): Result<TrialState> {
    const result = await this.client.from('tenants').select('*').eq('id', tenantId).maybeSingle();

    if (!result.data) {
      return { data: null, error: result.error };
    }

    return {
      data: toTrialState(result.data),
      error: result.error,
    };
  }
}
