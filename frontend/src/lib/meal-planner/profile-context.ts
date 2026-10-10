import type { UserCulinaryProfileRow } from '@/lib/db/types';
import type { UserCulinaryProfileTermWithLabel } from '@/lib/db/repositories/culinaryProfileRepository';

const EMPTY_PROFILE_MARKER = 'Sin perfil culinario configurado.';
const MAX_LEVEL_LENGTH = 50;
const MAX_TERM_LABEL_LENGTH = 100;
const MAX_VALUES_PER_FIELD = 12;
const MAX_HOUSEHOLD_MEMBERS = 20;
const MAX_PROFILE_ALLERGY_AND_DISLIKE_VALUES = 20;
const MAX_AVAILABLE_TIME_MINUTES = 24 * 60;

type ProfileContextField = 'identity' | 'preferred' | 'avoid' | 'goals';

export interface PersistedMealPlanProfileContext {
  identity: string[];
  preferred: string[];
  avoid: string[];
  goals: string[];
  level?: string;
  availableTimeMinutes?: number;
  allergies?: string[];
  dislikedIngredients?: string[];
  householdCounts?: { adult: number; teen: number; child: number };
}

function normalizeValue(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeStringList(
  values: readonly string[],
  maxValues = MAX_VALUES_PER_FIELD
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = normalizeValue(value, MAX_TERM_LABEL_LENGTH);
    const key = item.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (!item || seen.has(key) || normalized.length >= maxValues) continue;
    seen.add(key);
    normalized.push(item);
  }
  return normalized;
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

  const level = typeof profile.level === 'string' ? normalizeValue(profile.level, MAX_LEVEL_LENGTH) : '';
  if (level) context.level = level;

  if (
    typeof profile.available_time_minutes === 'number' &&
    Number.isInteger(profile.available_time_minutes) &&
    profile.available_time_minutes >= 1 &&
    profile.available_time_minutes <= MAX_AVAILABLE_TIME_MINUTES
  ) {
    context.availableTimeMinutes = profile.available_time_minutes;
  }

  const allergies = Array.isArray(profile.allergies)
    ? normalizeStringList(
        profile.allergies.filter((value): value is string => typeof value === 'string'),
        MAX_PROFILE_ALLERGY_AND_DISLIKE_VALUES
      )
    : [];
  if (allergies.length > 0) context.allergies = allergies;

  const dislikedIngredients = Array.isArray(profile.disliked_ingredients)
    ? normalizeStringList(
        profile.disliked_ingredients.filter((value): value is string => typeof value === 'string'),
        MAX_PROFILE_ALLERGY_AND_DISLIKE_VALUES
      )
    : [];
  if (dislikedIngredients.length > 0) context.dislikedIngredients = dislikedIngredients;

  const householdCounts = { adult: 0, teen: 0, child: 0 };
  if (Array.isArray(profile.household_members)) {
    for (const member of profile.household_members.slice(0, MAX_HOUSEHOLD_MEMBERS)) {
      if (!member || typeof member !== 'object') continue;
      if (member.ageGroup === 'adult' || member.ageGroup === 'teen' || member.ageGroup === 'child') {
        householdCounts[member.ageGroup] += 1;
      }
    }
  }
  if (Object.values(householdCounts).some((count) => count > 0)) {
    context.householdCounts = householdCounts;
  }

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
  if (context.availableTimeMinutes !== undefined) {
    lines.push(`Tiempo disponible: ${context.availableTimeMinutes} minutos`);
  }
  if (context.allergies?.length) {
    lines.push(`Alergias: ${context.allergies.join(', ')}`);
  }
  if (context.dislikedIngredients?.length) {
    lines.push(`No me gusta: ${context.dislikedIngredients.join(', ')}`);
  }
  if (context.householdCounts) {
    const { adult, teen, child } = context.householdCounts;
    lines.push(
      `Hogar: ${adult} ${adult === 1 ? 'adulto' : 'adultos'}, ${teen} ${teen === 1 ? 'adolescente' : 'adolescentes'}, ${child} ${child === 1 ? 'niño' : 'niños'}`
    );
  }

  return lines.join('\n') || EMPTY_PROFILE_MARKER;
}
