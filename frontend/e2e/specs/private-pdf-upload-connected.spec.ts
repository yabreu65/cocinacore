import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { injectAuth, signupIsolatedE2EUser } from '../fixtures/auth';
import {
  assertE2EDisposableIsolation,
  resolveAuthenticatedE2EIdentity,
} from '../fixtures/database';
import { validateE2ETargets } from '../database-target';

function onePagePdf(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

test('private PDF: real browser upload persists indexed text and remains isolated', async ({
  page,
  browser,
}) => {
  await injectAuth(page);
  const identity = await resolveAuthenticatedE2EIdentity(page);
  const title = `E2E private PDF ${randomUUID()}`;
  const marker = `COCINACORE_PRIVATE_PDF_${randomUUID().replace(/-/g, '')}`;
  const db = new Pool({ connectionString: validateE2ETargets(process.env).databaseUrl });
  let pdfId: string | undefined;
  let foreignContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    await assertE2EDisposableIsolation(db);
    await page.route('**/api/library/private-pdfs/embeddings', async (route) => {
      const data = route.request().postDataJSON() as { texts: string[] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ embeddings: data.texts.map(() => Array<number>(1536).fill(0.125)) }),
      });
    });
    await page.goto('/library/upload');
    await expect(page.getByRole('heading', { name: 'Subir libro PDF' })).toBeVisible();
    await page.getByRole('textbox', { name: /Título/ }).fill(title);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'private-e2e.pdf',
      mimeType: 'application/pdf',
      buffer: onePagePdf(`${marker} receta privada de tomate y albahaca`),
    });
    const uploadResponsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/library/private-pdfs') &&
        response.request().method() === 'POST'
    );
    await page.getByRole('button', { name: 'Subir e indexar PDF' }).click();
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status(), await uploadResponse.text()).toBe(201);
    const payload = (await uploadResponse.json()) as { id?: string; bookId?: string };
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);
    pdfId = payload.id;
    await expect(page.getByText('Libro PDF cargado e indexado correctamente.')).toBeVisible();
    await page.goto('/library');
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const stored = await db.query<{ text: string; source_type: string; tenant_id: string }>(
      `select c.content as text, c.source_type, c.tenant_id
         from public.book_chunks c
         where c.tenant_book_id = $1 and c.tenant_id = $2`,
      [payload.bookId, identity.tenantId]
    );
    expect(stored.rows.length).toBeGreaterThan(0);
    expect(
      stored.rows.some(
        (row) =>
          row.text.includes(marker) &&
          row.source_type === 'tenant_pdf' &&
          row.tenant_id === identity.tenantId
      )
    ).toBe(true);

    foreignContext = await browser.newContext();
    const foreign = await foreignContext.newPage();
    await signupIsolatedE2EUser(foreign, 'pdf-private-foreign');
    const foreignIdentity = await resolveAuthenticatedE2EIdentity(foreign);
    expect(foreignIdentity.tenantId).not.toBe(identity.tenantId);
    await foreign.goto('/library');
    await expect(foreign.getByText(title, { exact: true })).toHaveCount(0);
    const denied = await foreign.request.delete(`/api/library/pdfs/${pdfId}`);
    expect(denied.status()).toBe(404);

    const deleted = await page.request.delete(`/api/library/pdfs/${pdfId}`);
    expect(deleted.status(), await deleted.text()).toBe(200);
    pdfId = undefined;
    const missing = await db.query<{ count: string }>(
      'select count(*)::text as count from public.book_chunks where tenant_book_id=$1 and tenant_id=$2',
      [payload.bookId, identity.tenantId]
    );
    expect(missing.rows[0]?.count).toBe('0');
  } finally {
    if (pdfId) {
      // Only the newly created synthetic test document in the disposable E2E tenant.
      await page.request.delete(`/api/library/pdfs/${pdfId}`).catch(() => undefined);
    }
    await foreignContext?.close();
    await db.end();
  }
});
