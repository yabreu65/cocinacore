'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { requiresPasswordMfa } from '@/lib/auth/guards';
import type { AuthState, AuthUser, MfaState, TenantContext } from '@/lib/auth/types';
import { safeFetch } from '@/lib/api';

const initialState: AuthState = {
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
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    let active = true;

    async function loadAuthState() {
      try {
        const result = await safeFetch<{ user: AuthUser | null }>('/api/auth/session', {
          credentials: 'same-origin',
        });
        const user = result.ok ? result.data.user ?? null : null;
        const tenant: TenantContext | null = user?.tenant ?? null;

        let mfa: MfaState = { assuranceLevel: null, required: false, verified: false };
        if (user && tenant?.role) {
          mfa = {
            assuranceLevel: toMfaAssuranceLevel(null),
            required: requiresPasswordMfa(),
            verified: false,
          };
        }

        if (!active) return;
        setState({
          user,
          tenant,
          mfa,
          loading: false,
        });
      } catch {
        if (!active) return;
        setState({ ...initialState, loading: false });
      }
    }

    void loadAuthState();

    return () => {
      active = false;
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
