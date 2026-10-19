import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import {
  createPersistentRecipe,
  findDuplicatePersistentRecipeTitles,
  listPersistentRecipes,
} from '@/lib/db/repositories/recipeRepository';
import {
  CreatePersistentRecipeSchema,
  PersistentRecipeListQuerySchema,
  validateRequest,
} from '@/lib/validation';
import {
  recipeErrorResponse,
  toPublicRecipe,
  toPublicRecipeListItem,
  unauthorizedResponse,
} from './_shared';

export async function GET(request: NextRequest) {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
    ]);
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    const parsed = PersistentRecipeListQuerySchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    }
    const recipes = await listPersistentRecipes(
      { tenantId: tenant.tenantId, userId: user.id },
      parsed.data
    );
    return NextResponse.json({ items: recipes.map(toPublicRecipeListItem) });
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'list');
  }
}

export async function POST(request: NextRequest) {
  try {
    const [tenant, user] = await Promise.all([
      requireTenant(request, 'Unauthorized'),
      requireUser(request, 'Unauthorized'),
    ]);
    const validation = await validateRequest(request, CreatePersistentRecipeSchema);
    if (!validation.success) {
      return NextResponse.json(validation.error.body, { status: validation.error.status });
    }
    const scope = { tenantId: tenant.tenantId, userId: user.id };
    let duplicates: Awaited<ReturnType<typeof findDuplicatePersistentRecipeTitles>> = [];
    try {
      duplicates = await findDuplicatePersistentRecipeTitles(scope, validation.data.title);
    } catch {
      // Duplicate detection is advisory; persistence must remain available if it fails.
    }
    const recipe = await createPersistentRecipe(scope, validation.data);
    return NextResponse.json(
      { recipe: toPublicRecipe(recipe), warnings: { duplicates } },
      { status: 201 }
    );
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'create');
  }
}
