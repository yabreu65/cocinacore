export const COOKING_SESSION_STATUSES = ['active', 'paused', 'completed', 'cancelled'] as const;
export type CookingSessionStatus = (typeof COOKING_SESSION_STATUSES)[number];

export const COOKING_SESSION_ACTIONS = [
  'pause',
  'resume',
  'advance',
  'back',
  'complete',
  'cancel',
] as const;
export type CookingSessionAction = (typeof COOKING_SESSION_ACTIONS)[number];

export interface CookingInstructionStep {
  index: number;
  title: string;
  instruction: string;
}

export interface CookingInstructionIngredient {
  name: string;
  quantity: string | null;
  unit: string | null;
}

export interface CookingInstructionSnapshot {
  recipeId: string;
  versionId: string;
  servings: number | null;
  ingredients: CookingInstructionIngredient[];
  steps: CookingInstructionStep[];
}

export interface CookingSessionState {
  status: CookingSessionStatus;
  currentStep: number;
  totalSteps: number;
  version: number;
}

export type CookingSessionTransitionResult =
  | { ok: true; status: CookingSessionStatus; currentStep: number; version: number }
  | { ok: false; reason: 'invalid_transition' | 'step_boundary' | 'session_closed' };

const MAX_INSTRUCTION_LENGTH = 20_000;
const MAX_TITLE_LENGTH = 160;
const MAX_INGREDIENTS = 100;

export function createInstructionSnapshot(
  recipeId: string,
  versionId: string,
  title: string,
  instructions: string,
  servings: number | null,
  ingredients: Array<{ name: unknown; quantity?: unknown; unit?: unknown }>
): CookingInstructionSnapshot | null {
  const normalizedTitle = title.trim().replace(/\s+/g, ' ');
  const normalizedInstructions = instructions.trim();
  const normalizedIngredients = ingredients.map((ingredient) => ({
    name: typeof ingredient.name === 'string' ? ingredient.name.trim() : '',
    quantity: normalizeIngredientValue(ingredient.quantity),
    unit: normalizeIngredientValue(ingredient.unit),
  }));
  if (
    normalizedTitle.length === 0 ||
    normalizedTitle.length > MAX_TITLE_LENGTH ||
    normalizedInstructions.length === 0 ||
    normalizedInstructions.length > MAX_INSTRUCTION_LENGTH ||
    (!Number.isInteger(servings) && servings !== null) ||
    (servings !== null && servings < 1) ||
    normalizedIngredients.length === 0 ||
    normalizedIngredients.length > MAX_INGREDIENTS ||
    normalizedIngredients.some((ingredient) => ingredient.name.length === 0)
  ) {
    return null;
  }
  return {
    recipeId,
    versionId,
    servings,
    ingredients: normalizedIngredients,
    steps: [{ index: 1, title: normalizedTitle, instruction: normalizedInstructions }],
  };
}

function normalizeIngredientValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function transitionCookingSession(
  session: CookingSessionState,
  action: CookingSessionAction
): CookingSessionTransitionResult {
  if (session.status === 'completed' || session.status === 'cancelled') {
    return { ok: false, reason: 'session_closed' };
  }
  if (action === 'pause') {
    if (session.status !== 'active') return { ok: false, reason: 'invalid_transition' };
    return {
      ok: true,
      status: 'paused',
      currentStep: session.currentStep,
      version: session.version + 1,
    };
  }
  if (action === 'resume') {
    if (session.status !== 'paused') return { ok: false, reason: 'invalid_transition' };
    return {
      ok: true,
      status: 'active',
      currentStep: session.currentStep,
      version: session.version + 1,
    };
  }
  if (action === 'advance' || action === 'back') {
    if (session.status !== 'active') return { ok: false, reason: 'invalid_transition' };
    const nextStep = action === 'advance' ? session.currentStep + 1 : session.currentStep - 1;
    if (nextStep < 1 || nextStep > session.totalSteps) {
      return { ok: false, reason: 'step_boundary' };
    }
    return { ok: true, status: 'active', currentStep: nextStep, version: session.version + 1 };
  }
  if (action === 'complete') {
    if (session.status !== 'active' || session.currentStep !== session.totalSteps) {
      return { ok: false, reason: 'invalid_transition' };
    }
    return {
      ok: true,
      status: 'completed',
      currentStep: session.totalSteps,
      version: session.version + 1,
    };
  }
  if (session.status !== 'active' && session.status !== 'paused') {
    return { ok: false, reason: 'invalid_transition' };
  }
  return {
    ok: true,
    status: 'cancelled',
    currentStep: session.currentStep,
    version: session.version + 1,
  };
}
