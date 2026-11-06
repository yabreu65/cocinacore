import { z } from 'zod';
import type { TenantContext, TenantRole, TenantType } from '@/lib/auth/types';

export const OPERATIONAL_DOMAINS = [
  'household',
  'professional',
  'restaurant',
  'bakery',
  'pastry',
  'catering',
] as const;

export type OperationalDomain = (typeof OPERATIONAL_DOMAINS)[number];
export type OperationalAction = 'read' | 'operate' | 'manage_settings';

export type OperationalValidationCode =
  | 'tenant_context_invalid'
  | 'role_not_supported'
  | 'calendar_limit_exceeded'
  | 'portion_limit_exceeded'
  | 'batching_not_configured'
  | 'production_not_configured'
  | 'payload_invalid';

export interface OperationalDomainPolicy {
  domain: OperationalDomain;
  tenantType: TenantType;
  calendar: {
    maxDays: 30;
    maxMealsPerDay: 3;
  };
  portions: {
    minPeople: 1;
    maxPeople: 100;
    fractionalPeople: false;
    confirmationRequired: true;
  };
  batching: {
    enabled: false;
    maxBatches: 0;
    maxUnits: 0;
  };
  production: {
    enabled: false;
    maxUnits: 0;
  };
}

export interface OperationalContext {
  policy: OperationalDomainPolicy;
  adapterStatus: 'active' | 'planned';
}

export type OperationalValidationResult<T> =
  | { success: true; data: T; context: OperationalContext }
  | { success: false; code: OperationalValidationCode };

const ACTIVE_POLICIES: Record<'household' | 'professional', OperationalDomainPolicy> = {
  household: {
    domain: 'household',
    tenantType: 'home',
    calendar: { maxDays: 30, maxMealsPerDay: 3 },
    portions: {
      minPeople: 1,
      maxPeople: 100,
      fractionalPeople: false,
      confirmationRequired: true,
    },
    batching: { enabled: false, maxBatches: 0, maxUnits: 0 },
    production: { enabled: false, maxUnits: 0 },
  },
  professional: {
    domain: 'professional',
    tenantType: 'professional',
    calendar: { maxDays: 30, maxMealsPerDay: 3 },
    portions: {
      minPeople: 1,
      maxPeople: 100,
      fractionalPeople: false,
      confirmationRequired: true,
    },
    batching: { enabled: false, maxBatches: 0, maxUnits: 0 },
    production: { enabled: false, maxUnits: 0 },
  },
};

const FUTURE_DOMAINS = new Set<OperationalDomain>(['restaurant', 'bakery', 'pastry', 'catering']);

const PERIOD_DAY_COUNTS = {
  week: 7,
  fortnight: 14,
  month: 30,
} as const;

export const OperationalMealPlanRequestSchema = z
  .object({
    period: z.enum(['week', 'fortnight', 'month']),
    peopleCount: z.number().int().min(1).max(100),
  })
  .strict();

export type OperationalMealPlanRequest = z.infer<typeof OperationalMealPlanRequestSchema>;

export const OperationalBatchProductionRequestSchema = z
  .object({
    batchCount: z.number().int().min(1).max(1000),
    unitsPerBatch: z.number().int().min(1).max(1000),
    productionUnits: z.number().int().min(1).max(1000),
  })
  .strict();

export type OperationalBatchProductionRequest = z.infer<
  typeof OperationalBatchProductionRequestSchema
>;

function isTenantType(value: unknown): value is TenantType {
  return value === 'home' || value === 'professional';
}

function isTenantRole(value: unknown): value is TenantRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function policyForTenantType(tenantType: TenantType): OperationalDomainPolicy {
  return ACTIVE_POLICIES[tenantType === 'home' ? 'household' : 'professional'];
}

export function resolveOperationalContext(
  tenant: Pick<TenantContext, 'tenantId' | 'tenantType' | 'role'>
): OperationalContext | null {
  if (!tenant.tenantId.trim() || !isTenantType(tenant.tenantType) || !isTenantRole(tenant.role)) {
    return null;
  }

  return { policy: policyForTenantType(tenant.tenantType), adapterStatus: 'active' };
}

export function canPerformOperationalAction(role: unknown, action: OperationalAction): boolean {
  if (!isTenantRole(role)) return false;
  if (action === 'manage_settings') return role === 'owner' || role === 'admin';
  return true;
}

export function validateTenantUserScope(
  context: { tenantId: string; userId: string },
  target: { tenantId: unknown; userId: unknown }
): boolean {
  return (
    context.tenantId.trim().length > 0 &&
    context.userId.trim().length > 0 &&
    target.tenantId === context.tenantId &&
    target.userId === context.userId
  );
}

export function validateOperationalMealPlanRequest(
  tenant: Pick<TenantContext, 'tenantId' | 'tenantType' | 'role'>,
  input: unknown
): OperationalValidationResult<OperationalMealPlanRequest> {
  const context = resolveOperationalContext(tenant);
  if (!context) return { success: false, code: 'tenant_context_invalid' };
  if (!canPerformOperationalAction(tenant.role, 'operate')) {
    return { success: false, code: 'role_not_supported' };
  }

  const parsed = OperationalMealPlanRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, code: 'payload_invalid' };

  if (PERIOD_DAY_COUNTS[parsed.data.period] > context.policy.calendar.maxDays) {
    return { success: false, code: 'calendar_limit_exceeded' };
  }
  if (
    parsed.data.peopleCount < context.policy.portions.minPeople ||
    parsed.data.peopleCount > context.policy.portions.maxPeople
  ) {
    return { success: false, code: 'portion_limit_exceeded' };
  }

  return { success: true, data: parsed.data, context };
}

export function validateOperationalBatchProductionRequest(
  tenant: Pick<TenantContext, 'tenantId' | 'tenantType' | 'role'>,
  input: unknown
): OperationalValidationResult<OperationalBatchProductionRequest> {
  const context = resolveOperationalContext(tenant);
  if (!context) return { success: false, code: 'tenant_context_invalid' };
  if (!canPerformOperationalAction(tenant.role, 'operate')) {
    return { success: false, code: 'role_not_supported' };
  }

  const parsed = OperationalBatchProductionRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, code: 'payload_invalid' };
  if (!context.policy.batching.enabled) return { success: false, code: 'batching_not_configured' };
  if (!context.policy.production.enabled) {
    return { success: false, code: 'production_not_configured' };
  }

  if (
    parsed.data.batchCount > context.policy.batching.maxBatches ||
    parsed.data.unitsPerBatch > context.policy.batching.maxUnits ||
    parsed.data.productionUnits > context.policy.production.maxUnits
  ) {
    return { success: false, code: 'portion_limit_exceeded' };
  }

  return { success: true, data: parsed.data, context };
}

export function listPlannedOperationalDomains(): OperationalDomain[] {
  return [...FUTURE_DOMAINS];
}

export function isPlannedOperationalDomain(domain: unknown): domain is OperationalDomain {
  return typeof domain === 'string' && FUTURE_DOMAINS.has(domain as OperationalDomain);
}
