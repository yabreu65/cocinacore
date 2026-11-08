import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCookingTeacherBudget,
  CookingTeacherBudgetExceededError,
  startCookingTeacherBudget,
} from './cooking-teacher-budget';

describe('cooking teacher shared budget', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.COOKING_TEACHER_TIMEOUT_MS;
  });

  it('propagates client aborts to the shared controller and fails closed', () => {
    const parent = new AbortController();
    const budget = startCookingTeacherBudget(parent.signal);

    parent.abort();

    expect(budget.controller.signal.aborted).toBe(true);
    expect(() => assertCookingTeacherBudget(budget.deadlineAt, budget.controller.signal)).toThrow(
      CookingTeacherBudgetExceededError
    );
    budget.dispose();
  });

  it('aborts the shared controller at the configured deadline', () => {
    vi.useFakeTimers();
    process.env.COOKING_TEACHER_TIMEOUT_MS = '1000';
    const budget = startCookingTeacherBudget();

    vi.advanceTimersByTime(1000);

    expect(budget.controller.signal.aborted).toBe(true);
    budget.dispose();
  });
});
