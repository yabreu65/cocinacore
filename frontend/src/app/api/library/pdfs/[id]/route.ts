import { type NextRequest, NextResponse } from 'next/server';
import { requireRole, requireTenant } from '@/lib/auth/server';
import {
  countTenantPdfsByBookId,
  deleteTenantBookById,
  deleteTenantPdfById,
  findTenantPdfById,
} from '@/lib/db/repositories/pdfRepository';
import { localStorageAdapter } from '@/lib/storage/localStorageAdapter';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id: pdfId } = await context.params;
  try {
    const user = await requireRole(['owner', 'admin', 'member'], request, 'Unauthorized');
    const tenant = await requireTenant(request, 'Forbidden');
    const pdfRow = await findTenantPdfById(tenant.tenantId, pdfId);

    if (!pdfRow) {
      return NextResponse.json({ error: 'PDF not found.' }, { status: 404 });
    }

    const canDelete =
      user.tenant.role === 'owner' ||
      user.tenant.role === 'admin' ||
      pdfRow.uploaded_by === user.id;

    if (!canDelete) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await deleteTenantPdfById(tenant.tenantId, pdfId);

    if (pdfRow.tenant_book_id) {
      const remainingCount = await countTenantPdfsByBookId(tenant.tenantId, pdfRow.tenant_book_id);
      if (remainingCount === 0) {
        await deleteTenantBookById(tenant.tenantId, pdfRow.tenant_book_id);
      }
    }

    await localStorageAdapter.deleteFile(pdfRow.storage_path).catch(() => undefined);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Forbidden';
    const status = message === 'Unauthorized' ? 401 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}
