import type { Session, User } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export type TenantRole = Database['public']['Tables']['users']['Row']['role'];

export interface TenantContext {
  tenantId: string | null;
  role: TenantRole | null;
  onboardingCompleted: boolean | null;
}

export interface MfaState {
  assuranceLevel: 'aal1' | 'aal2' | null;
  required: boolean;
  verified: boolean;
}

export interface AuthState {
  session: Session | null;
  user: User | null;
  tenant: TenantContext | null;
  mfa: MfaState;
  loading: boolean;
}

export interface GuardResult {
  allowed: boolean;
  redirectTo?: string;
  reason?: 'unauthenticated' | 'missing-tenant' | 'insufficient-role' | 'mfa-required';
}
