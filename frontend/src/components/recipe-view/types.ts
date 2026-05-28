export type GenerationMode = 'free' | 'rag';

export type RecipeSections = {
  title: string;
  ingredients: string[];
  preparation: string[];
  tips: string[];
  fallback: string;
};

export type RecipeCitation = {
  id: string;
  content: string;
  similarity: number | string | null;
  metadata?: { page_number?: number; book_title?: string };
};

export type IngredientSplit = {
  quantity: string;
  name: string;
};
