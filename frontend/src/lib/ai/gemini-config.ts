/**
 * Returns a usable Gemini API key or null when the key is unset,
 * empty, or still set to the placeholder value.
 */
export function getGeminiApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'CHANGE_ME') {
    return null;
  }
  return key;
}

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
}

export function getGeminiEmbeddingModel(): string {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || 'gemini-embedding-001';
}
