import { type NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/server';
import {
  countTenantPdfsByBookId,
  deleteTenantBookById,
  deleteTenantPdfById,
  findTenantPdfById,
} from '@/lib/db/repositories/pdfRepository';
import { getStorageAdapter, getStorageDriver } from '@/lib/storage';
import { privatePdfStorageConfigured } from '@/lib/private-pdf/config';
import { deleteTenantPdf } from '@/lib/storage/tenantPdfStorage';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id: pdfId } = await context.params;
  try {
    const user = await requireRole(['owner', 'admin', 'member'], request, 'Unauthorized');
    const tenant = user.tenant;
    const scope = { tenantId: tenant.tenantId, userId: user.id };
    const pdfRow = await findTenantPdfById(tenant.tenantId, pdfId, scope);

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

    if (!privatePdfStorageConfigured()) {
      return NextResponse.json({ error: 'Private PDF storage unavailable.' }, { status: 503 });
    }
    const isPrivatePath = pdfRow.storage_path.startsWith('tenant-pdfs/');
    if (getStorageDriver() === 's3' || isPrivatePath) {
      try {
        await deleteTenantPdf({ tenantId: tenant.tenantId, storagePath: pdfRow.storage_path });
      } catch {
        return NextResponse.json({ error: 'Private PDF deletion unavailable.' }, { status: 503 });
      }
    } else {
      await getStorageAdapter()
        .deleteFile(pdfRow.storage_path)
        .catch(() => undefined);
    }

    await deleteTenantPdfById(tenant.tenantId, pdfId, scope);

    if (pdfRow.tenant_book_id) {
      const remainingCount = await countTenantPdfsByBookId(
        tenant.tenantId,
        pdfRow.tenant_book_id,
        scope
      );
      if (remainingCount === 0) {
        await deleteTenantBookById(tenant.tenantId, pdfRow.tenant_book_id, scope);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof Error && error.message === 'Unauthorized'
        ? 401
        : error instanceof Error && error.message === 'Forbidden'
          ? 403
          : 500;
    return NextResponse.json(
      {
        error:
          status === 401
            ? 'Unauthorized'
            : status === 403
              ? 'Forbidden'
              : 'No se pudo eliminar el PDF.',
      },
      { status }
    );
  }
}
