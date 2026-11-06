import { describe, expect, it } from 'vitest';
import { createInstructionSnapshot, transitionCookingSession } from './cooking-session';

const session = { status: 'active' as const, currentStep: 1, totalSteps: 2, version: 4 };

describe('cooking session domain', () => {
  it('normalizes an unstructured recipe into one immutable step', () => {
    expect(
      createInstructionSnapshot('recipe-1', 'version-1', '  Rice  ', '  Cook\n slowly  ', 2, [
        { name: ' Rice ', quantity: '1', unit: ' cup ' },
      ])
    ).toEqual({
      recipeId: 'recipe-1',
      versionId: 'version-1',
      servings: 2,
      ingredients: [{ name: 'Rice', quantity: '1', unit: 'cup' }],
      steps: [{ index: 1, title: 'Rice', instruction: 'Cook\n slowly' }],
    });
  });

  it('rejects empty or oversized instructions', () => {
    expect(
      createInstructionSnapshot('recipe-1', 'version-1', 'Rice', ' ', 2, [
        { name: 'Rice', quantity: '1', unit: 'cup' },
      ])
    ).toBeNull();
    expect(
      createInstructionSnapshot('recipe-1', 'version-1', 'Rice', 'x'.repeat(20_001), 2, [
        { name: 'Rice', quantity: '1', unit: 'cup' },
      ])
    ).toBeNull();
  });

  it.each([
    ['pause', 'paused', 1],
    ['advance', 'active', 2],
    ['back', 'active', 0],
  ] as const)('handles %s deterministically', (action, status, step) => {
    const result = transitionCookingSession(session, action);
    if (action === 'back') {
      expect(result).toEqual({ ok: false, reason: 'step_boundary' });
    } else {
      expect(result).toMatchObject({ ok: true, status, currentStep: step || 1, version: 5 });
    }
  });

  it('requires an explicit complete action at the final step', () => {
    expect(transitionCookingSession({ ...session, currentStep: 2 }, 'complete')).toEqual({
      ok: true,
      status: 'completed',
      currentStep: 2,
      version: 5,
    });
    expect(transitionCookingSession(session, 'complete')).toEqual({
      ok: false,
      reason: 'invalid_transition',
    });
  });

  it('rejects changes after closure', () => {
    expect(transitionCookingSession({ ...session, status: 'completed' }, 'resume')).toEqual({
      ok: false,
      reason: 'session_closed',
    });
  });
});
