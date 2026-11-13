import { describe, expect, it } from 'vitest';
import {
  evaluateFamilyWeekCleanup,
  EXPECTED_FAMILY_WEEK_RETENTION,
} from '../../e2e/fixtures/family-week-cleanup-contract';
const empty = { movements: '0', shopping: '0', plans: '0', inventory: '0' };
describe('family-week E2E retention contract', () => {
  it('explicitly reports verified protected retention after the complete scenario', () => {
    expect(
      evaluateFamilyWeekCleanup({
        protectedReferences: true,
        expectProtectedRetention: true,
        leftovers: { ...EXPECTED_FAMILY_WEEK_RETENTION },
      })
    ).toMatchObject({
      verified: true,
      disposition: 'retained-protected',
      leftovers: EXPECTED_FAMILY_WEEK_RETENTION,
    });
  });
  it('requires exact retained counts, not just the existence of audit references', () => {
    for (const key of Object.keys(EXPECTED_FAMILY_WEEK_RETENTION)) {
      expect(
        evaluateFamilyWeekCleanup({
          protectedReferences: true,
          expectProtectedRetention: true,
          leftovers: { ...EXPECTED_FAMILY_WEEK_RETENTION, [key]: '99' },
        })
      ).toMatchObject({ verified: false, disposition: 'incomplete' });
    }
  });
  it('rejects unexpected protected retention on the setup-failure path', () => {
    expect(
      evaluateFamilyWeekCleanup({
        protectedReferences: true,
        expectProtectedRetention: false,
        leftovers: { ...EXPECTED_FAMILY_WEEK_RETENTION },
      }).verified
    ).toBe(false);
  });
  it('rejects missing audit references when retention was expected, even with zero leftovers', () => {
    expect(
      evaluateFamilyWeekCleanup({
        protectedReferences: false,
        expectProtectedRetention: true,
        leftovers: empty,
      }).verified
    ).toBe(false);
  });
  it('accepts only verified zero leftovers for ordinary cleanup', () => {
    expect(
      evaluateFamilyWeekCleanup({
        protectedReferences: false,
        expectProtectedRetention: false,
        leftovers: empty,
      })
    ).toMatchObject({ verified: true, disposition: 'clean' });
    expect(
      evaluateFamilyWeekCleanup({
        protectedReferences: false,
        expectProtectedRetention: false,
        leftovers: { ...empty, inventory: '1' },
      }).verified
    ).toBe(false);
  });
  it.each([true, false])(
    'fails closed if the scoped count is unavailable (%s)',
    (protectedReferences) => {
      expect(
        evaluateFamilyWeekCleanup({
          protectedReferences,
          expectProtectedRetention: protectedReferences,
          leftovers: null,
        }).verified
      ).toBe(false);
    }
  );
});
