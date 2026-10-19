import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  appendPersistentRecipeVersion,
  findPersistentRecipeDetail,
} from '@/lib/db/repositories/recipeRepository';
import { EditPersistentRecipeSchema, PersistentRecipeIdSchema, validateRequest } from '@/lib/validation';
import { recipeErrorResponse, toPublicRecipe, toPublicRecipeVersion, unauthorizedResponse } from '../_shared';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const [tenant, user, { id }] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
      context.params,
    ]);
    if (!PersistentRecipeIdSchema.safeParse(id).success) {
      return NextResponse.json({ error: 'Invalid recipe id' }, { status: 400 });
    }
    const recipe = await findPersistentRecipeDetail(id, { tenantId: tenant.tenantId, userId: user.id });
    if (!recipe) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    return NextResponse.json({ recipe: toPublicRecipe(recipe) });
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'get');
  }
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
    const validation = await validateRequest(request, EditPersistentRecipeSchema);
    if (!validation.success) {
      return NextResponse.json(validation.error.body, { status: validation.error.status });
    }
    const scope = { tenantId: tenant.tenantId, userId: user.id };
    const version = await appendPersistentRecipeVersion(id, scope, validation.data);
    if (!version) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    const recipe = await findPersistentRecipeDetail(id, scope);
    if (!recipe) return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    return NextResponse.json({ recipe: toPublicRecipe(recipe), version: toPublicRecipeVersion(version) });
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'update');
  }
}
