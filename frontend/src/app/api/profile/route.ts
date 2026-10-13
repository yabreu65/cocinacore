import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { transaction } from '@/lib/db';
import { updateUserInTransaction } from '@/lib/db/repositories/userRepository';
import {
  findCulinaryProfileByUserId,
  findCulinaryProfileByUserIdInTransaction,
  findCulinaryProfileTermsByUserId,
  findCulinaryProfileTermsByUserIdInTransaction,
  listCulinaryDimensions,
  listCulinaryTerms,
  lockCulinaryProfileUpdateInTransaction,
  saveCulinaryProfileInTransaction,
  type UserCulinaryProfileTermWithLabel,
  ProfileTenantMismatchError,
} from '@/lib/db/repositories/culinaryProfileRepository';
import type {
  CulinaryDimensionRow,
  CulinaryTermRow,
  PreferenceType,
  UserCulinaryProfileRow,
} from '@/lib/db/types';

const TermIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const SelectionFieldSchema = z.array(TermIdSchema).max(12);
const SelectionsSchema = z.object({
  favoriteCuisineTermIds: SelectionFieldSchema.max(6).optional(),
  dietaryAvoidTermIds: SelectionFieldSchema.optional(),
  techniqueTermIds: SelectionFieldSchema.max(8).optional(),
  ingredientTypeTermIds: SelectionFieldSchema.max(8).optional(),
  goalTermIds: SelectionFieldSchema.max(6).optional(),
}).strict();

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeTextList(values: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const displayValue = normalizeText(value);
    if (!displayValue) continue;
    const key = displayValue.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(displayValue);
  }
  return normalized;
}

const TextListSchema = z.array(z.string().max(80)).max(20).transform(normalizeTextList);
const HouseholdMemberSchema = z.object({
  name: z.string().max(60).transform(normalizeText),
  ageGroup: z.enum(['adult', 'teen', 'child']),
}).strict().refine((member) => member.name.length > 0);

const ProfileUpdateSchema = z.object({
  fullName: z.string().max(120).transform(normalizeText).optional(),
  level: z.enum(['Principiante', 'Intermedio', 'Chef']).nullable().optional(),
  availableTimeMinutes: z.number().int().min(5).max(240).nullable().optional(),
  dislikedIngredients: TextListSchema.optional(),
  allergies: TextListSchema.optional(),
  householdMembers: z.array(HouseholdMemberSchema).max(12).optional(),
  selections: SelectionsSchema.optional(),
  onboardingCompleted: z.literal(true).optional(),
  // Accepted only to avoid trusting client identity; session identity always wins.
  userId: z.string().optional(),
  tenantId: z.string().optional(),
}).strict();

type SubmittedSelections = z.infer<typeof SelectionsSchema>;
type CanonicalSelections = Required<SubmittedSelections>;

class InvalidCulinarySelectionsError extends Error {}

function createEmptySelections(): CanonicalSelections {
  return {
    favoriteCuisineTermIds: [],
    dietaryAvoidTermIds: [],
    techniqueTermIds: [],
    ingredientTypeTermIds: [],
    goalTermIds: [],
  };
}

const GROUP_CONTRACT = {
  favoriteCuisineTermIds: { dimensionKey: 'cuisine', preferenceType: 'identity' },
  dietaryAvoidTermIds: { dimensionKey: 'dietary', preferenceType: 'avoid' },
  techniqueTermIds: { dimensionKey: 'technique', preferenceType: 'prefer' },
  ingredientTypeTermIds: { dimensionKey: 'ingredient_type', preferenceType: 'prefer' },
  goalTermIds: { dimensionKey: 'goal', preferenceType: 'goal' },
} as const satisfies Record<keyof CanonicalSelections, { dimensionKey: string; preferenceType: PreferenceType }>;

function publicTaxonomy(dimensions: CulinaryDimensionRow[], terms: CulinaryTermRow[]) {
  return {
    dimensions: dimensions.map((dimension) => ({
      id: dimension.id,
      key: dimension.key,
      label: dimension.label,
      sortOrder: dimension.sort_order,
    })),
    terms: terms.filter((term) => term.is_active).map((term) => ({
      id: term.id,
      dimensionId: term.dimension_id,
      label: term.label,
    })),
  };
}

function buildSelections(
  dimensions: CulinaryDimensionRow[],
  terms: CulinaryTermRow[],
  selectedTerms: UserCulinaryProfileTermWithLabel[]
): CanonicalSelections {
  const dimensionById = new Map(dimensions.map((dimension) => [dimension.id, dimension.key]));
  const termById = new Map(terms.filter((term) => term.is_active).map((term) => [term.id, term]));
  const selections = createEmptySelections();

  for (const selected of selectedTerms) {
    const term = termById.get(selected.term_id);
    if (!term) continue;
    const dimensionKey = dimensionById.get(term.dimension_id);
    const group = (Object.keys(GROUP_CONTRACT) as Array<keyof CanonicalSelections>).find(
      (key) => GROUP_CONTRACT[key].dimensionKey === dimensionKey &&
        GROUP_CONTRACT[key].preferenceType === selected.preference_type
    );
    if (group) selections[group].push(term.id);
  }
  for (const key of Object.keys(selections) as Array<keyof CanonicalSelections>) {
    selections[key] = [...new Set(selections[key])];
  }
  return selections;
}

function canonicalTermsFromSelections(
  selections: CanonicalSelections,
  dimensions: CulinaryDimensionRow[],
  terms: CulinaryTermRow[]
): Array<{ termId: string; preferenceType: PreferenceType }> | null {
  const dimensionById = new Map(dimensions.map((dimension) => [dimension.id, dimension.key]));
  const activeTermById = new Map(terms.filter((term) => term.is_active).map((term) => [term.id, term]));
  const result: Array<{ termId: string; preferenceType: PreferenceType }> = [];
  for (const key of Object.keys(GROUP_CONTRACT) as Array<keyof CanonicalSelections>) {
    const contract = GROUP_CONTRACT[key];
    for (const termId of [...new Set(selections[key])]) {
      const term = activeTermById.get(termId);
      if (!term || dimensionById.get(term.dimension_id) !== contract.dimensionKey) return null;
      result.push({ termId, preferenceType: contract.preferenceType });
    }
  }
  return result;
}

function publicProfile(profile: UserCulinaryProfileRow | null, userId: string, tenantId: string | null) {
  if (!profile || !tenantId || profile.user_id !== userId || profile.tenant_id !== tenantId) return null;
  return {
    level: profile.level,
    availableTimeMinutes: profile.available_time_minutes,
    dislikedIngredients: profile.disliked_ingredients,
    allergies: profile.allergies,
    householdMembers: profile.household_members,
  };
}

async function loadTaxonomy() {
  const [dimensions, terms] = await Promise.all([listCulinaryDimensions(), listCulinaryTerms(undefined, true)]);
  return { dimensions, terms };
}

export async function GET() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [profile, selectedTerms, taxonomy] = await Promise.all([
      findCulinaryProfileByUserId(user.id),
      findCulinaryProfileTermsByUserId(user.id),
      loadTaxonomy(),
    ]);
    const safeProfile = publicProfile(profile, user.id, user.tenant?.tenantId ?? null);
    return NextResponse.json({
      user,
      profile: safeProfile,
      taxonomy: publicTaxonomy(taxonomy.dimensions, taxonomy.terms),
      selections: safeProfile ? buildSelections(taxonomy.dimensions, taxonomy.terms, selectedTerms) : createEmptySelections(),
    });
  } catch {
    return NextResponse.json({ error: 'Unable to retrieve profile' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!user.tenant) return NextResponse.json({ error: 'Tenant context required' }, { status: 400 });
  const tenantId = user.tenant.tenantId;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid profile data' }, { status: 400 });

  try {
    const taxonomy = await loadTaxonomy();
    const userChanges: { fullName?: string | null; onboardingCompleted?: boolean } = {};
    if (parsed.data.fullName !== undefined) userChanges.fullName = parsed.data.fullName || null;
    if (parsed.data.onboardingCompleted === true) userChanges.onboardingCompleted = true;

    const { updatedUser, profile, effectiveSelections } = await transaction(async (client) => {
      await lockCulinaryProfileUpdateInTransaction(client, user.id);
      const existingProfile = await findCulinaryProfileByUserIdInTransaction(client, user.id);
      if (existingProfile && existingProfile.tenant_id !== tenantId) {
        throw new ProfileTenantMismatchError();
      }
      const currentTerms = await findCulinaryProfileTermsByUserIdInTransaction(client, user.id);
      const currentSelections = buildSelections(taxonomy.dimensions, taxonomy.terms, currentTerms);
      const effectiveSelections: CanonicalSelections = parsed.data.selections !== undefined
        ? { ...currentSelections, ...parsed.data.selections }
        : currentSelections;
      let canonicalTerms: Array<{ termId: string; preferenceType: PreferenceType }> | undefined;
      if (parsed.data.selections !== undefined) {
        canonicalTerms = canonicalTermsFromSelections(effectiveSelections, taxonomy.dimensions, taxonomy.terms) ?? undefined;
        if (!canonicalTerms) throw new InvalidCulinarySelectionsError();
      }

      const profileInput = {
        userId: user.id,
        tenantId,
        ...(parsed.data.level !== undefined ? { level: parsed.data.level } : {}),
        ...(parsed.data.availableTimeMinutes !== undefined ? { availableTimeMinutes: parsed.data.availableTimeMinutes } : {}),
        ...(parsed.data.dislikedIngredients !== undefined ? { dislikedIngredients: parsed.data.dislikedIngredients } : {}),
        ...(parsed.data.allergies !== undefined ? { allergies: parsed.data.allergies } : {}),
        ...(parsed.data.householdMembers !== undefined ? { householdMembers: parsed.data.householdMembers } : {}),
        ...(canonicalTerms !== undefined ? { terms: canonicalTerms } : {}),
      };
      const updatedUser = Object.keys(userChanges).length > 0
        ? await updateUserInTransaction(client, user.id, userChanges)
        : null;
      const profile = await saveCulinaryProfileInTransaction(client, profileInput);
      return { updatedUser, profile, effectiveSelections };
    });

    return NextResponse.json({
      user: {
        ...user,
        fullName: parsed.data.fullName !== undefined ? parsed.data.fullName || null : updatedUser?.full_name ?? user.fullName,
        onboardingCompleted: parsed.data.onboardingCompleted === true ? true : updatedUser?.onboarding_completed ?? user.onboardingCompleted,
        tenant: { ...user.tenant, onboardingCompleted: parsed.data.onboardingCompleted === true ? true : user.tenant.onboardingCompleted },
      },
      profile: publicProfile(profile, user.id, user.tenant.tenantId),
      selections: effectiveSelections,
    });
  } catch (error) {
    if (error instanceof InvalidCulinarySelectionsError) {
      return NextResponse.json({ error: 'Invalid culinary selections' }, { status: 400 });
    }
    if (error instanceof ProfileTenantMismatchError) {
      return NextResponse.json({ error: 'profile_tenant_mismatch' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Unable to update profile' }, { status: 500 });
  }
}
