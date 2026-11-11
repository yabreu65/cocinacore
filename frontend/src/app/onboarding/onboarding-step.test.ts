import { describe, expect, it } from 'vitest';
import { canAdvanceOnboardingStep } from './onboarding-step';

describe('onboarding empty taxonomy options', () => {
  it.each(['cuisine', 'dietary', 'goal'] as const)('allows %s without server options', (key) => {
    expect(canAdvanceOnboardingStep({ key, options: [] }, 0)).toBe(true);
  });
  it('requires a selection when options exist', () => {
    expect(canAdvanceOnboardingStep({ key: 'cuisine', options: [{ id: 'a' }] }, 0)).toBe(false);
    expect(canAdvanceOnboardingStep({ key: 'cuisine', options: [{ id: 'a' }] }, 1)).toBe(true);
  });
  it('still requires a culinary level', () => {
    expect(canAdvanceOnboardingStep({ key: 'level', options: [] }, 0)).toBe(false);
    expect(canAdvanceOnboardingStep({ key: 'level', options: [] }, 1)).toBe(true);
  });
  it('does not enable navigation before loading', () => {
    expect(canAdvanceOnboardingStep(undefined, 0)).toBe(false);
  });
});
