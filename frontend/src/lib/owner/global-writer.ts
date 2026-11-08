import { globalWriterTransaction, isGlobalWriterEnabled } from '@/lib/db';

export interface GlobalUpload {
  book: {
    title: string;
    author: string | null;
    description: string | null;
    cuisineRegion: string;
    cuisineCountry: string | null;
    cuisineStyle: string | null;
    tags: string[];
  };
  pdf: {
    storagePath: string;
    fileSizeBytes: number;
    pageCount: number;
    checksumSha256: string;
    uploadedBy: string;
  };
  chunks: Array<{ content: string; metadata: unknown; embedding: number[] }>;
}

/** Only invoke after verifying the server-side session and platform-owner authorization. */
export async function createGlobalUpload(input: GlobalUpload): Promise<string> {
  const separated = isGlobalWriterEnabled();
  const books = separated ? 'public.owner_write_global_books' : 'public.global_books';
  const pdfs = separated ? 'public.owner_write_global_pdfs' : 'public.global_pdf_library';
  const chunks = separated ? 'public.owner_write_global_chunks' : 'public.book_chunks';
  return globalWriterTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into ${books} (title, author, description, cuisine_region, cuisine_country, cuisine_style, tags)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        input.book.title,
        input.book.author,
        input.book.description,
        input.book.cuisineRegion,
        input.book.cuisineCountry,
        input.book.cuisineStyle,
        input.book.tags,
      ]
    );
    const bookId = result.rows[0]?.id;
    if (!bookId) throw new Error('Failed to create global book');
    await client.query(
      `insert into ${pdfs} (global_book_id, storage_path, file_size_bytes, page_count, checksum_sha256, uploaded_by)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        bookId,
        input.pdf.storagePath,
        input.pdf.fileSizeBytes,
        input.pdf.pageCount,
        input.pdf.checksumSha256,
        input.pdf.uploadedBy,
      ]
    );
    if (input.chunks.length) {
      const values: unknown[] = [];
      const slots = input.chunks.map((chunk, i) => {
        const n = i * 4;
        values.push(bookId, chunk.content, chunk.metadata, JSON.stringify(chunk.embedding));
        return `(null, null, $${n + 1}, 'global_pdf', $${n + 2}, $${n + 3}, $${n + 4}::vector(1536))`;
      });
      await client.query(
        `insert into ${chunks} (tenant_id, tenant_book_id, global_book_id, source_type, content, metadata, embedding) values ${slots.join(', ')}`,
        values
      );
    }
    return bookId;
  }).catch((error: unknown) => {
    if (separated) throw new Error('Global upload database is unavailable.');
    throw error;
  });
}
