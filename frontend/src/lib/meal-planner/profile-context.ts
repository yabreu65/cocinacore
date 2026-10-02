import type { UserCulinaryProfileRow } from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';

const EMPTY_PROFILE_MARKER = 'Sin perfil culinario configurado.';
const MAX_LEVEL_LENGTH = 50;
const MAX_TERM_LABEL_LENGTH = 100;
const MAX_VALUES_PER_FIELD = 12;

type ProfileContextField = 'identity' | 'preferred' | 'avoid' | 'goals';

export interface PersistedMealPlanProfileContext {
  identity: string[];
  preferred: string[];
  avoid: string[];
  goals: string[];
  level?: string;
}

function normalizeValue(value: string, maxLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function buildPersistedMealPlanProfileContext(
  profile: UserCulinaryProfileRow | null,
  terms: readonly UserCulinaryProfileTermWithLabel[],
  userId: string,
  tenantId: string
): PersistedMealPlanProfileContext | null {
  if (!profile || profile.user_id !== userId || profile.tenant_id !== tenantId) {
    return null;
  }

  const context: PersistedMealPlanProfileContext = {
    identity: [],
    preferred: [],
    avoid: [],
    goals: [],
  };
  const seen: Record<ProfileContextField, Set<string>> = {
    identity: new Set(),
    preferred: new Set(),
    avoid: new Set(),
    goals: new Set(),
  };
  const fieldsByPreferenceType: Record<
    UserCulinaryProfileTermWithLabel['preference_type'],
    ProfileContextField
  > = {
    identity: 'identity',
    prefer: 'preferred',
    avoid: 'avoid',
    goal: 'goals',
  };

  for (const term of terms) {
    if (term.user_id !== userId) continue;

    const field = fieldsByPreferenceType[term.preference_type];
    const label = normalizeValue(term.term_label, MAX_TERM_LABEL_LENGTH);
    if (!label || seen[field].has(label) || context[field].length >= MAX_VALUES_PER_FIELD) {
      continue;
    }

    seen[field].add(label);
    context[field].push(label);
  }

  const level = profile.level ? normalizeValue(profile.level, MAX_LEVEL_LENGTH) : '';
  if (level) context.level = level;

  return context;
}

export function formatPersistedMealPlanProfileContext(
  context: PersistedMealPlanProfileContext | null
): string {
  if (!context) return EMPTY_PROFILE_MARKER;

  const lines: string[] = [];
  if (context.identity.length > 0) {
    lines.push(`Identidad/contexto: ${context.identity.join(', ')}`);
  }
  if (context.preferred.length > 0) {
    lines.push(`Preferencias: ${context.preferred.join(', ')}`);
  }
  if (context.avoid.length > 0) {
    lines.push(`Evitar: ${context.avoid.join(', ')}`);
  }
  if (context.goals.length > 0) {
    lines.push(`Objetivos: ${context.goals.join(', ')}`);
  }
  if (context.level) {
    lines.push(`Nivel: ${context.level}`);
  }

  return lines.join('\n') || EMPTY_PROFILE_MARKER;
}
