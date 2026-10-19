import { type NextRequest, NextResponse } from 'next/server';
import { requireTenant, requireUser } from '@/lib/auth/server';
import { findPersistentRecipeDetail, listPersistentRecipeVersions } from '@/lib/db/repositories/recipeRepository';
import { PersistentRecipeIdSchema } from '@/lib/validation';
import { recipeErrorResponse, toPublicRecipeVersion, unauthorizedResponse } from '../../_shared';

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
    const scope = { tenantId: tenant.tenantId, userId: user.id };
    if (!(await findPersistentRecipeDetail(id, scope))) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 });
    }
    const versions = await listPersistentRecipeVersions(id, scope);
    return NextResponse.json({ versions: versions.map(toPublicRecipeVersion) });
  } catch (error) {
    return unauthorizedResponse(error) ?? recipeErrorResponse(error, 'list versions for');
  }
}
