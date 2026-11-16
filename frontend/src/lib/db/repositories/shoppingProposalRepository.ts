import { scopedTransaction, type AuthenticatedDbScope } from '@/lib/db';
import { lockInventorySourceTenant } from '@/lib/db/inventory-source-lock';
import type { DbTransactionClient } from '@/lib/db/transaction-client';
import type { RecipeInventoryItemRow, ShoppingListItemRow, UserMealPlanRow } from '@/lib/db/types';
import { parseStructuredMealPlanValue } from '@/lib/meal-planner/structured-plan';
import {
  buildPredictiveShoppingProposal,
  createLegacyUtcShoppingFingerprint,
  type PredictiveShoppingProposal,
} from '@/lib/meal-planner/predictive-shopping';

const MAX_SOURCE_ROWS = 500;
type Source =
  | { status: 'not_found' }
  | { status: 'invalid_plan' }
  | { status: 'truncated' }
  | {
      status: 'loaded';
      plan: UserMealPlanRow;
      proposal: PredictiveShoppingProposal;
      legacyFingerprint: string | null;
    };

/** All participating writers acquire this tenant lock before reading or
 * modifying these sources. READ COMMITTED makes reads after a lock wait fresh.
 * The caller's confirmation/write callback runs before the same transaction
 * commits; it must not open another connection. GET uses the same snapshot
 * protocol so its fingerprint is not assembled from independently read rows. */
export async function withShoppingProposalSource<T>(
  scope: AuthenticatedDbScope,
  mealPlanId: string,
  horizonDays: 7 | 14,
  callback: (client: DbTransactionClient, source: Source) => T | Promise<T>
): Promise<T> {
  return scopedTransaction(
    scope,
    async (client) => {
      await lockInventorySourceTenant(client, scope.tenantId);
      const plans = await client.query<UserMealPlanRow>(
        `select * from public.user_meal_plans where id = $1 and tenant_id = $2 and user_id = $3 limit 1`,
        [mealPlanId, scope.tenantId, scope.userId]
      );
      const plan = plans.rows[0];
      if (!plan) return callback(client, { status: 'not_found' });
      const parsed = parseStructuredMealPlanValue(plan.calendar_payload, plan.period);
      if (!parsed.success) return callback(client, { status: 'invalid_plan' });
      // Preserve the current tenant-shared inventory and user-specific shopping
      // contracts; ownership changes are a separate work unit.
      const inventory = await client.query<RecipeInventoryItemRow>(
        `select * from public.recipe_inventory_items where tenant_id = $1 order by created_at desc, id desc limit $2`,
        [scope.tenantId, MAX_SOURCE_ROWS + 1]
      );
      if (inventory.rows.length > MAX_SOURCE_ROWS) return callback(client, { status: 'truncated' });
      const shopping = await client.query<ShoppingListItemRow>(
        `select * from public.shopping_list_items where tenant_id = $1 and user_id = $2 order by created_at desc, id desc limit $3`,
        [scope.tenantId, scope.userId, MAX_SOURCE_ROWS + 1]
      );
      if (shopping.rows.length > MAX_SOURCE_ROWS) return callback(client, { status: 'truncated' });
      const input = {
        plan: parsed.plan,
        consumptionPayload: plan.consumption_payload,
        inventoryItems: inventory.rows,
        shoppingItems: shopping.rows,
        horizonDays,
        now: new Date(),
      };
      return callback(client, {
        status: 'loaded',
        plan,
        proposal: buildPredictiveShoppingProposal(input),
        legacyFingerprint: createLegacyUtcShoppingFingerprint(input),
      });
    },
    { isolationLevel: 'read committed' }
  );
}
