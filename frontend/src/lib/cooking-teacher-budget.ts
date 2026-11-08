export const COOKING_TEACHER_DEFAULT_TIMEOUT_MS = 15_000;
export const COOKING_TEACHER_MIN_TIMEOUT_MS = 1_000;
export const COOKING_TEACHER_MAX_TIMEOUT_MS = 15_000;

export class CookingTeacherBudgetExceededError extends Error {
  constructor() {
    super('Cooking teacher time budget exceeded.');
    this.name = 'CookingTeacherBudgetExceededError';
  }
}

export function getCookingTeacherTimeoutMs(): number {
  const configured = Number(
    process.env.COOKING_TEACHER_TIMEOUT_MS ?? COOKING_TEACHER_DEFAULT_TIMEOUT_MS
  );
  return Number.isInteger(configured) &&
    configured >= COOKING_TEACHER_MIN_TIMEOUT_MS &&
    configured <= COOKING_TEACHER_MAX_TIMEOUT_MS
    ? configured
    : COOKING_TEACHER_DEFAULT_TIMEOUT_MS;
}

export function getRemainingCookingTeacherBudgetMs(deadlineAt: number): number {
  if (!Number.isFinite(deadlineAt)) return 0;
  return Math.max(0, Math.floor(deadlineAt - Date.now()));
}

export function assertCookingTeacherBudget(
  deadlineAt: number | undefined,
  signal?: AbortSignal
): number {
  if (signal?.aborted) throw new CookingTeacherBudgetExceededError();
  if (deadlineAt === undefined) return getCookingTeacherTimeoutMs();
  const remaining = getRemainingCookingTeacherBudgetMs(deadlineAt);
  if (remaining < 1) throw new CookingTeacherBudgetExceededError();
  return remaining;
}

export function startCookingTeacherBudget(parentSignal?: AbortSignal): {
  controller: AbortController;
  deadlineAt: number;
  dispose: () => void;
} {
  const controller = new AbortController();
  const deadlineAt = Date.now() + getCookingTeacherTimeoutMs();
  const timeout = setTimeout(
    () => controller.abort(),
    getRemainingCookingTeacherBudgetMs(deadlineAt)
  );
  const abortFromParent = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    controller,
    deadlineAt,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}
