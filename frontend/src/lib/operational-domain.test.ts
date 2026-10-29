import { describe, expect, it } from 'vitest';
import {
  canPerformOperationalAction,
  isPlannedOperationalDomain,
  listPlannedOperationalDomains,
  OperationalBatchProductionRequestSchema,
  resolveOperationalContext,
  validateOperationalBatchProductionRequest,
  validateOperationalMealPlanRequest,
  validateTenantUserScope,
} from './operational-domain';
import { MealPlanRequestSchema } from './validation';

const tenant = (
  role: 'owner' | 'admin' | 'member' = 'member',
  tenantType: 'home' | 'professional' = 'home'
) => ({
  tenantId: 'tenant-1',
  tenantType,
  role,
});

describe('operational domain policy', () => {
  it.each(['owner', 'admin', 'member'] as const)(
    'allows %s to operate within its own tenant',
    (role) => {
      const result = validateOperationalMealPlanRequest(tenant(role), {
        period: 'month',
        peopleCount: 100,
      });

      expect(result.success).toBe(true);
    }
  );

  it('allows only owner and admin to manage domain settings', () => {
    expect(canPerformOperationalAction('owner', 'manage_settings')).toBe(true);
    expect(canPerformOperationalAction('admin', 'manage_settings')).toBe(true);
    expect(canPerformOperationalAction('member', 'manage_settings')).toBe(false);
    expect(canPerformOperationalAction('unknown', 'manage_settings')).toBe(false);
  });

  it('resolves household and professional baseline adapters without claiming future modules', () => {
    expect(resolveOperationalContext(tenant('owner'))).toMatchObject({
      adapterStatus: 'active',
      policy: { domain: 'household', tenantType: 'home' },
    });
    expect(resolveOperationalContext(tenant('owner', 'professional'))).toMatchObject({
      adapterStatus: 'active',
      policy: { domain: 'professional', tenantType: 'professional' },
    });
    expect(listPlannedOperationalDomains()).toEqual(['restaurant', 'bakery', 'pastry', 'catering']);
    expect(isPlannedOperationalDomain('restaurant')).toBe(true);
    expect(isPlannedOperationalDomain('household')).toBe(false);
  });

  it('fails closed for an invalid tenant context', () => {
    expect(
      resolveOperationalContext({ tenantId: '', tenantType: 'home', role: 'member' })
    ).toBeNull();
    expect(
      validateOperationalMealPlanRequest(
        { tenantId: 'tenant-1', tenantType: 'invalid' as 'home', role: 'member' },
        { period: 'week', peopleCount: 2 }
      )
    ).toEqual({ success: false, code: 'tenant_context_invalid' });
  });

  it('enforces the existing 30-day calendar and 1..100 portion contract', () => {
    expect(
      validateOperationalMealPlanRequest(tenant(), { period: 'month', peopleCount: 100 }).success
    ).toBe(true);
    expect(
      validateOperationalMealPlanRequest(tenant(), { period: 'month', peopleCount: 101 })
    ).toEqual({ success: false, code: 'payload_invalid' });
    expect(
      validateOperationalMealPlanRequest(tenant(), { period: 'week', peopleCount: 0 })
    ).toEqual({ success: false, code: 'payload_invalid' });
  });

  it('rejects batch and production operations until a domain adapter is explicitly configured', () => {
    const parsed = OperationalBatchProductionRequestSchema.safeParse({
      batchCount: 1,
      unitsPerBatch: 10,
      productionUnits: 10,
    });
    expect(parsed.success).toBe(true);
    expect(
      validateOperationalBatchProductionRequest(tenant(), {
        batchCount: 1,
        unitsPerBatch: 10,
        productionUnits: 10,
      })
    ).toEqual({ success: false, code: 'batching_not_configured' });
    expect(
      OperationalBatchProductionRequestSchema.safeParse({
        batchCount: 1,
        unitsPerBatch: 10,
        productionUnits: 10,
        tenantId: 'client-controlled',
      }).success
    ).toBe(false);
  });

  it('keeps the meal-plan request strict while preserving explicitly documented legacy fields', () => {
    expect(
      MealPlanRequestSchema.safeParse({
        mode: 'balanced_ai',
        availableTimeMinutes: 240,
        userId: 'browser-user',
        tenantId: 'browser-tenant',
      }).success
    ).toBe(true);
    expect(
      MealPlanRequestSchema.safeParse({ mode: 'balanced_ai', unexpectedClientField: true }).success
    ).toBe(false);
    expect(
      MealPlanRequestSchema.safeParse({ mode: 'balanced_ai', availableTimeMinutes: '240' }).success
    ).toBe(false);
  });

  it('enforces tenant and user scope without trusting client authority', () => {
    expect(
      validateTenantUserScope(
        { tenantId: 'tenant-1', userId: 'user-1' },
        { tenantId: 'tenant-1', userId: 'user-1' }
      )
    ).toBe(true);
    expect(
      validateTenantUserScope(
        { tenantId: 'tenant-1', userId: 'user-1' },
        { tenantId: 'tenant-2', userId: 'user-1' }
      )
    ).toBe(false);
    expect(
      validateTenantUserScope(
        { tenantId: 'tenant-1', userId: 'user-1' },
        { tenantId: 'tenant-1', userId: 'user-2' }
      )
    ).toBe(false);
  });
});
