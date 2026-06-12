'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { requiresPasswordMfa } from '@/lib/auth/guards';
import { getSupabaseBrowserClient } from '@/lib/supabaseClient';
import type { AuthState, MfaState, TenantContext } from '@/lib/auth/types';

const initialState: AuthState = {
  session: null,
  user: null,
  tenant: null,
  mfa: { assuranceLevel: null, required: false, verified: false },
  loading: true,
};

const AuthContext = createContext<AuthState>(initialState);

function toMfaAssuranceLevel(value: unknown): MfaState['assuranceLevel'] {
  return value === 'aal1' || value === 'aal2' ? value : null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let active = true;

    async function loadAuthState() {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user ?? null;
      let tenant: TenantContext | null = null;

      if (user) {
        const { data } = await supabase
          .from('users')
          .select('tenant_id, role, onboarding_completed')
          .eq('id', user.id)
          .maybeSingle();
        tenant = data
          ? {
              tenantId: data.tenant_id,
              role: data.role,
              onboardingCompleted: data.onboarding_completed,
            }
          : null;
      }

      let mfa: MfaState = { assuranceLevel: null, required: false, verified: false };
      if (user && tenant?.role) {
        const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const assuranceLevel = toMfaAssuranceLevel(assurance?.currentLevel);
        const required = requiresPasswordMfa(tenant.role, user);
        mfa = { assuranceLevel, required, verified: assuranceLevel === 'aal2' };
      }

      if (!active) return;
      setState({
        session: sessionData.session,
        user,
        tenant,
        mfa,
        loading: false,
      });
    }

    void loadAuthState();
    const { data } = supabase.auth.onAuthStateChange(() => {
      void loadAuthState();
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
