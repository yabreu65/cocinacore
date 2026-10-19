import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  findPersistentRecipeDetail,
  setPersistentRecipeArchived,
} from '@/lib/db/repositories/recipeRepository';
import { PersistentRecipeArchiveSchema, PersistentRecipeIdSchema, validateRequest } from '@/lib/validation';
import { recipeErrorResponse, toPublicRecipe, unauthorizedResponse } from '../../_shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [tenant, user, { id }] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
      context.params,
    ]);
    if (!PersistentRecipeIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid recipe id' }, { status: 400 });
    }
    const validation = await validateRequest(request, PersistentRecipeArchiveSchema);
    if (!validation.success) {
      return NextResponse.json(validation.error.body, { status: validation.error.status });
    }
    const scope = { tenantId: tenant.tenantId, userId: user.id };
    const updated = await setPersistentRecipeArchived(id, scope, validation.data.archived);
    if (!updated) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    const recipe = await findPersistentRecipeDetail(id, scope);
    if (!recipe) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    return NextResponse.json({ recipe: toPublicRecipe(recipe) });
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'archive');
  }
}
