type StepOptions = {
  key: 'level' | 'cuisine' | 'dietary' | 'goal';
  options: ReadonlyArray<{ id: string }>;
};

/** Optional taxonomy steps must not trap users when the API has no entries. */
export function canAdvanceOnboardingStep(
  step: StepOptions | undefined,
  selectedCount: number
): boolean {
  if (!step) return false;
  if (step.key === 'level') return selectedCount > 0;
  return step.options.length === 0 || selectedCount > 0;
}
