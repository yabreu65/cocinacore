import { PdfChunkerService, RecipeBookChunk, ChunkOptions } from './types';

export class PdfChunker implements PdfChunkerService {
  /**
   * Chunks text from a cookbook PDF page or full book.
   * Cleans white spaces, preserves sentence/paragraph boundaries, and creates overlapping windows.
   */
  public chunkPdfText(
    text: string,
    metadata: { book_id: string; book_title?: string; page_number?: number },
    options: ChunkOptions = {}
  ): RecipeBookChunk[] {
    const chunkSize = options.chunkSize ?? 800; // chars count (roughly 120-150 words)
    const chunkOverlap = options.chunkOverlap ?? 150; // chars overlap

    if (!text || text.trim() === '') {
      return [];
    }

    // Clean up excessive whitespace but maintain single/double newlines for structures
    const cleanText = text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // If text is short, return a single chunk directly
    if (cleanText.length <= chunkSize) {
      return [
        {
          book_id: metadata.book_id,
          content: cleanText,
          metadata: {
            page_number: metadata.page_number,
            book_title: metadata.book_title,
          },
        },
      ];
    }

    const chunks: RecipeBookChunk[] = [];
    let cursor = 0;

    while (cursor < cleanText.length) {
      // Basic end index calculation
      let end = cursor + chunkSize;

      if (end >= cleanText.length) {
        end = cleanText.length;
      } else {
        // Try to find the nearest semantic boundary (paragraph double-newlines, single-newline, or sentence period)
        // to avoid splitting mid-sentence or mid-instruction
        const windowSlice = cleanText.substring(cursor, end);

        // Look for double newlines (paragraph boundary) within the last 30% of the chunk size
        const lastThirtyPercent = Math.floor(chunkSize * 0.3);
        const searchStart = chunkSize - lastThirtyPercent;

        const doubleNewlineIndex = windowSlice.indexOf('\n\n', searchStart);
        if (doubleNewlineIndex !== -1) {
          end = cursor + doubleNewlineIndex;
        } else {
          // Fallback: look for a period followed by space/newline within the last 20%
          const lastTwentyPercent = Math.floor(chunkSize * 0.2);
          const periodSearchStart = chunkSize - lastTwentyPercent;
          const periodIndex = windowSlice.search(/(?<=\.)\s+(?=[A-Z])/g); // Period followed by spaces and a capital letter

          if (periodIndex !== -1 && periodIndex > periodSearchStart) {
            end = cursor + periodIndex + 1; // Include the period
          } else {
            // Fallback: look for single newline
            const newlineIndex = windowSlice.indexOf('\n', searchStart);
            if (newlineIndex !== -1) {
              end = cursor + newlineIndex;
            } else {
              // Fallback: look for space to avoid breaking a word
              const lastSpace = windowSlice.lastIndexOf(' ');
              if (lastSpace !== -1 && lastSpace > searchStart) {
                end = cursor + lastSpace;
              }
            }
          }
        }
      }

      const content = cleanText.substring(cursor, end).trim();
      if (content.length > 50) {
        // Filter out extremely tiny or empty chunks
        chunks.push({
          book_id: metadata.book_id,
          content,
          metadata: {
            page_number: metadata.page_number,
            book_title: metadata.book_title,
            chunk_start: cursor,
            chunk_end: end,
          },
        });
      }

      // Move cursor forward taking overlap into consideration
      const nextStep = end - cursor;
      if (nextStep <= chunkOverlap) {
        // Prevent infinite loop if we made no progress
        cursor = end;
      } else {
        cursor = end - chunkOverlap;
      }
    }

    return chunks;
  }
}
