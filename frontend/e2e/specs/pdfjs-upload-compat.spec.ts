import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { hasExplicitOwnerCredentials, injectOwnerAuth } from '../fixtures/auth';

function createOnePagePdf(text: string): Buffer {
  const escapedText = text.replace(/[\\()]/g, '\\$&');
  const content = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'ascii');
}

test.describe('Owner global PDF upload PDF.js compatibility', () => {
  test.skip(
    !hasExplicitOwnerCredentials(),
    'Global PDF upload E2E requires explicit platform-owner credentials.'
  );

  test('extracts and uploads PDF text with the matching PDF.js worker', async ({ page }) => {
    const marker = `PDFJS_UPLOAD_COMPAT_${randomUUID().replace(/-/g, '')}`;
    const extractedText = `${marker} Unique compatibility marker for PDF text extraction.`;
    const pageErrors: string[] = [];
    let uploadedChunks: Array<{ content: string; pageNumber: number }> | undefined;

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await injectOwnerAuth(page);

    await page.route('**/api/embeddings', async (route) => {
      const requestBody = route.request().postDataJSON() as { texts: string[] };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ embeddings: requestBody.texts.map(() => [0.1]) }),
      });
    });
    await page.route('**/api/owner/global-pdfs', async (route) => {
      const body = route.request().postDataBuffer()?.toString('utf8') ?? '';
      const chunksField = body.match(/name="chunks"\r\n\r\n([\s\S]*?)\r\n--/);
      if (chunksField) {
        uploadedChunks = JSON.parse(chunksField[1]) as Array<{
          content: string;
          pageNumber: number;
        }>;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ chunkCount: uploadedChunks?.length ?? 0 }),
      });
    });

    await page.goto('/owner/global-pdfs/upload');
    const workerResponsePromise = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/pdf.worker.min.mjs'
    );

    await page.getByLabel('Título del libro global').fill(`Compatibilidad ${marker}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'compatibility.pdf',
      mimeType: 'application/pdf',
      buffer: createOnePagePdf(extractedText),
    });
    await page.getByRole('button', { name: 'Subir e indexar PDF global' }).click();

    const workerResponse = await workerResponsePromise;
    expect(workerResponse.ok(), 'PDF.js worker request should succeed').toBe(true);
    expect(await workerResponse.text()).toContain('6.3.289');

    await expect(page.getByText(/Global PDF cargado e indexado:/)).toBeVisible();
    expect(uploadedChunks).toBeDefined();
    expect(uploadedChunks?.some((chunk) => chunk.content.includes(marker))).toBe(true);
    expect(pageErrors).toEqual([]);
  });
});
