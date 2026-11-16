// Pure reporting contract; no database or Playwright dependency.
export type CleanupCounts = {
  movements: string;
  shopping: string;
  plans: string;
  inventory: string;
};
export const EXPECTED_FAMILY_WEEK_RETENTION: Readonly<CleanupCounts> = {
  movements: '21',
  shopping: '1',
  plans: '1',
  inventory: '2',
};
const EMPTY: Readonly<CleanupCounts> = {
  movements: '0',
  shopping: '0',
  plans: '0',
  inventory: '0',
};

export function evaluateFamilyWeekCleanup(input: {
  protectedReferences: boolean;
  expectProtectedRetention: boolean;
  leftovers: CleanupCounts | null;
}) {
  const expected = input.expectProtectedRetention ? EXPECTED_FAMILY_WEEK_RETENTION : EMPTY;
  const countsMatch =
    input.leftovers !== null &&
    (Object.keys(expected) as (keyof CleanupCounts)[]).every(
      (key) => input.leftovers?.[key] === expected[key]
    );
  const verified = countsMatch && input.protectedReferences === input.expectProtectedRetention;
  return {
    disposition: verified
      ? input.protectedReferences
        ? 'retained-protected'
        : 'clean'
      : 'incomplete',
    verified,
    protectedReferences: input.protectedReferences,
    expected,
    leftovers: input.leftovers,
  } as const;
}
