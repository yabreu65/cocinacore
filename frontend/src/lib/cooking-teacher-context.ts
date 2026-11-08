import {
  findCulinaryProfileByUserAndTenant,
  findCulinaryProfileTermsByUserId,
  type UserCulinaryProfileTermWithLabel,
} from '@/lib/db/repositories/culinaryProfileRepository';
import { listInventoryItemsByTenant } from '@/lib/db/repositories/inventoryRepository';
import { findPersistentRecipeVersion } from '@/lib/db/repositories/recipeRepository';
import { getCookingSession } from '@/lib/db/repositories/cookingSessionRepository';
import type {
  ManualRecipeIngredient,
  RecipeInventoryItemRow,
  UserCulinaryProfileRow,
  UserRecipeVersionRow,
} from '@/lib/db/types';
import { normalizeInventoryName } from '@/lib/inventory/normalize-inventory';
import { assertCookingTeacherBudget } from '@/lib/cooking-teacher-budget';

/** Evidence exposed by the provider contract; deterministic verification is internal only. */
export type CookingTeacherEvidence = 'supported' | 'partial' | 'unknown';
export type CookingTeacherRestrictionStatus = 'clear' | 'blocked' | 'unknown';
export type CookingTeacherQuantityStatus = 'known' | 'unknown';

export interface CookingTeacherKnowledgeReference {
  title: string;
  page: number | null;
}

export interface CookingTeacherIngredientContext {
  name: string;
  quantity: string | null;
  unit: string | null;
  quantityStatus: CookingTeacherQuantityStatus;
  inventory: {
    status: 'available' | 'missing' | 'unknown';
    quantity: string | null;
    unit: string | null;
    quantityStatus: CookingTeacherQuantityStatus;
  };
}

export interface CookingTeacherContext {
  authorization: { verified: true; tenantScoped: true; writes: 'none' };
  session: {
    id: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    currentStep: number;
    totalSteps: number;
    mealType: 'breakfast' | 'lunch' | 'dinner';
    dayIndex: number;
  };
  recipe: {
    recipeId: string;
    versionId: string;
    versionNumber: number;
    title: string;
    servings: number | null;
  };
  operationalStep: {
    index: number;
    title: string;
    instruction: string;
  };
  pedagogicalBoundary: {
    derivedStagesAllowed: true;
    doNotAdvanceOperationalProgress: true;
    source: 'operational_step';
  };
  ingredients: CookingTeacherIngredientContext[];
  restrictions: {
    status: CookingTeacherRestrictionStatus;
    allergies: string[];
    avoids: string[];
    reasons: string[];
    evidence: CookingTeacherEvidence;
  };
  knowledgeReferences: CookingTeacherKnowledgeReference[];
  limitations: string[];
}

export interface CookingTeacherContextSource {
  session: {
    id: string;
    tenant_id: string;
    user_id: string;
    status: CookingTeacherContext['session']['status'];
    current_step: number;
    total_steps: number;
    meal_type: CookingTeacherContext['session']['mealType'];
    day_index: number;
    recipe_id: string;
    recipe_version_id: string;
    instruction_snapshot: unknown;
  };
  recipeVersion: UserRecipeVersionRow;
  profile: UserCulinaryProfileRow | null;
  profileTerms: UserCulinaryProfileTermWithLabel[];
  inventory: RecipeInventoryItemRow[];
}

interface InstructionSnapshot {
  ingredients?: unknown;
  steps?: unknown;
}

interface SnapshotStep {
  index: number;
  title: string;
  instruction: string;
}

function normalizedText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength)
    : '';
}

function safeIngredient(value: unknown): ManualRecipeIngredient | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const name = normalizedText(candidate.name, 200);
  if (!name) return null;
  const quantity =
    candidate.quantity === null ? null : normalizedText(candidate.quantity, 100) || null;
  const unit = candidate.unit === null ? null : normalizedText(candidate.unit, 50) || null;
  return { name, quantity, unit };
}

function safeIngredients(value: unknown): ManualRecipeIngredient[] {
  if (!Array.isArray(value)) return [];
  return value.map(safeIngredient).filter((item): item is ManualRecipeIngredient => item !== null);
}

function safeSteps(value: unknown): SnapshotStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    const title = normalizedText(candidate.title, 120) || `Paso ${index + 1}`;
    const instruction = normalizedText(candidate.instruction, 4000);
    if (!instruction) return [];
    const parsedIndex =
      typeof candidate.index === 'number' && Number.isInteger(candidate.index)
        ? candidate.index
        : index + 1;
    return [{ index: parsedIndex, title, instruction }];
  });
}

function quantityStatus(
  quantity: string | null,
  unit: string | null
): CookingTeacherQuantityStatus {
  return quantity && unit ? 'known' : 'unknown';
}

function matchingInventory(
  ingredientName: string,
  inventory: readonly RecipeInventoryItemRow[]
): RecipeInventoryItemRow | null {
  const normalized = normalizeInventoryName(ingredientName);
  return (
    inventory.find((item) => {
      const candidate = normalizeInventoryName(item.normalized_name ?? item.ingredient_name);
      return candidate === normalized;
    }) ?? null
  );
}

function ingredientContext(
  ingredient: ManualRecipeIngredient,
  inventory: readonly RecipeInventoryItemRow[]
): CookingTeacherIngredientContext {
  const item = matchingInventory(ingredient.name, inventory);
  const itemQuantity = item?.quantity ?? null;
  const itemUnit = item?.unit ?? null;
  const itemQuantityStatus = quantityStatus(itemQuantity, itemUnit);
  return {
    name: ingredient.name,
    quantity: ingredient.quantity ?? null,
    unit: ingredient.unit ?? null,
    quantityStatus: quantityStatus(ingredient.quantity ?? null, ingredient.unit ?? null),
    inventory: {
      status: item ? (itemQuantityStatus === 'known' ? 'available' : 'unknown') : 'unknown',
      quantity: itemQuantity,
      unit: itemUnit,
      quantityStatus: itemQuantityStatus,
    },
  };
}

function uniqueRestrictionValues(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (typeof value !== 'string') return [];
    const normalized = value.trim();
    const key = normalizeInventoryName(normalized);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [normalized];
  });
}

function profileRestrictions(
  profile: UserCulinaryProfileRow | null,
  profileTerms: readonly UserCulinaryProfileTermWithLabel[]
): {
  allergies: string[];
  avoids: string[];
  evidence: CookingTeacherEvidence;
} {
  if (!profile) return { allergies: [], avoids: [], evidence: 'unknown' };
  const persistedAvoids = profileTerms
    .filter((term) => term.preference_type === 'avoid')
    .map((term) => term.term_label);
  return {
    allergies: uniqueRestrictionValues(profile.allergies),
    avoids: uniqueRestrictionValues([
      ...(Array.isArray(profile.disliked_ingredients) ? profile.disliked_ingredients : []),
      ...persistedAvoids,
    ]),
    evidence: 'supported',
  };
}

function restrictionMatches(ingredientName: string, restriction: string): boolean {
  const ingredient = normalizeInventoryName(ingredientName);
  const value = normalizeInventoryName(restriction);
  return (
    Boolean(value) &&
    (ingredient === value || ingredient.includes(value) || value.includes(ingredient))
  );
}

export function buildCookingTeacherContext(
  source: CookingTeacherContextSource
): CookingTeacherContext {
  const snapshot = source.session.instruction_snapshot as InstructionSnapshot | null;
  const snapshotSteps = safeSteps(snapshot?.steps);
  const currentStep = snapshotSteps.find((step) => step.index === source.session.current_step);
  const recipeIngredients = safeIngredients(source.recipeVersion.ingredients);
  const restrictions = profileRestrictions(source.profile, source.profileTerms);
  const reasons = restrictions.allergies.flatMap((restriction) =>
    recipeIngredients.some((ingredient) => restrictionMatches(ingredient.name, restriction))
      ? [
          `La receta contiene un ingrediente que coincide con la alergia configurada: ${restriction}.`,
        ]
      : []
  );
  const avoidReasons = restrictions.avoids.flatMap((restriction) =>
    recipeIngredients.some((ingredient) => restrictionMatches(ingredient.name, restriction))
      ? [`La receta contiene un ingrediente marcado para evitar: ${restriction}.`]
      : []
  );
  const restrictionStatus: CookingTeacherRestrictionStatus = !source.profile
    ? 'unknown'
    : reasons.length > 0 || avoidReasons.length > 0
      ? 'blocked'
      : 'clear';
  const limitations: string[] = [];
  if (!source.profile) limitations.push('No hay un perfil culinario verificado para esta sesión.');
  if (!currentStep)
    limitations.push('El paso operativo actual no tiene instrucciones estructuradas disponibles.');
  if (source.session.status === 'completed' || source.session.status === 'cancelled') {
    limitations.push(
      'La sesión no está activa; el profesor solo puede explicar el contexto existente.'
    );
  }
  return {
    authorization: { verified: true, tenantScoped: true, writes: 'none' },
    session: {
      id: source.session.id,
      status: source.session.status,
      currentStep: source.session.current_step,
      totalSteps: source.session.total_steps,
      mealType: source.session.meal_type,
      dayIndex: source.session.day_index,
    },
    recipe: {
      recipeId: source.recipeVersion.recipe_id,
      versionId: source.recipeVersion.id,
      versionNumber: source.recipeVersion.version_number,
      title: source.recipeVersion.title,
      servings: source.recipeVersion.servings,
    },
    operationalStep: currentStep ?? {
      index: source.session.current_step,
      title: `Paso ${source.session.current_step}`,
      instruction: 'No hay instrucciones estructuradas disponibles para este paso.',
    },
    pedagogicalBoundary: {
      derivedStagesAllowed: true,
      doNotAdvanceOperationalProgress: true,
      source: 'operational_step',
    },
    ingredients: recipeIngredients.map((ingredient) =>
      ingredientContext(ingredient, source.inventory)
    ),
    restrictions: {
      status: restrictionStatus,
      allergies: restrictions.allergies,
      avoids: restrictions.avoids,
      reasons: [...reasons, ...avoidReasons],
      evidence: restrictions.evidence,
    },
    knowledgeReferences: [],
    limitations,
  };
}

export async function loadCookingTeacherContext(
  sessionId: string,
  tenantId: string,
  userId: string,
  options: { signal?: AbortSignal; deadlineAt?: number } = {}
): Promise<CookingTeacherContext | null> {
  const sessionTimeout = assertCookingTeacherBudget(options.deadlineAt, options.signal);
  const session = await getCookingSession(sessionId, tenantId, userId, sessionTimeout, options);
  if (!session) return null;
  const contextController = new AbortController();
  const abortFromParent = () => contextController.abort();
  if (options.signal) {
    if (options.signal.aborted) contextController.abort();
    else options.signal.addEventListener('abort', abortFromParent, { once: true });
  }
  const contextOptions = { signal: contextController.signal, deadlineAt: options.deadlineAt };
  const remainingTimeout = () =>
    assertCookingTeacherBudget(options.deadlineAt, contextController.signal);
  const runContextQuery = <T>(operation: () => Promise<T>): Promise<T> =>
    Promise.resolve()
      .then(operation)
      .catch((error: unknown) => {
        contextController.abort();
        throw error;
      });

  try {
    const results = await Promise.allSettled([
      runContextQuery(() =>
        findPersistentRecipeVersion(
          session.recipe_id,
          session.recipe_version_id,
          { tenantId, userId },
          remainingTimeout(),
          contextOptions
        )
      ),
      runContextQuery(() =>
        findCulinaryProfileByUserAndTenant(userId, tenantId, remainingTimeout(), contextOptions)
      ),
      runContextQuery(() =>
        listInventoryItemsByTenant(tenantId, 500, remainingTimeout(), contextOptions, {
          tenantId,
          userId,
        })
      ),
      runContextQuery(() =>
        findCulinaryProfileTermsByUserId(userId, tenantId, remainingTimeout(), contextOptions)
      ),
    ]);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (rejected) throw rejected.reason;
    const [recipeVersion, profile, inventory, profileTerms] = results.map(
      (result) => (result as PromiseFulfilledResult<unknown>).value
    ) as [
      Awaited<ReturnType<typeof findPersistentRecipeVersion>>,
      Awaited<ReturnType<typeof findCulinaryProfileByUserAndTenant>>,
      Awaited<ReturnType<typeof listInventoryItemsByTenant>>,
      Awaited<ReturnType<typeof findCulinaryProfileTermsByUserId>>,
    ];
    assertCookingTeacherBudget(options.deadlineAt, options.signal);
    if (
      !recipeVersion ||
      recipeVersion.tenant_id !== tenantId ||
      recipeVersion.user_id !== userId
    ) {
      return null;
    }
    return buildCookingTeacherContext({ session, recipeVersion, profile, profileTerms, inventory });
  } finally {
    options.signal?.removeEventListener('abort', abortFromParent);
    contextController.abort();
  }
}
