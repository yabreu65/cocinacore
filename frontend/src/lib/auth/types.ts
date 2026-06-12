export type TenantRole = 'owner' | 'admin' | 'member';
export type TenantType = 'home' | 'professional';

export interface TenantContext {
  tenantId: string;
  role: TenantRole;
  tenantType: TenantType;
  onboardingCompleted: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  tenant: TenantContext | null;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  onboardingCompleted: boolean;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  expiresAt: Date;
}

export interface MfaState {
  assuranceLevel: 'aal1' | 'aal2' | null;
  required: boolean;
  verified: boolean;
}

export interface AuthState {
  user: AuthUser | null;
  tenant: TenantContext | null;
  mfa: MfaState;
  loading: boolean;
}

export interface GuardResult {
  allowed: boolean;
  redirectTo?: string;
  reason?: 'unauthenticated' | 'missing-tenant' | 'insufficient-role' | 'mfa-required';
}
