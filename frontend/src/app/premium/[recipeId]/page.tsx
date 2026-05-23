import Link from 'next/link';
import { notFound } from 'next/navigation';

import PremiumRecipeDetailClient from './PremiumRecipeDetailClient';
import { currentUserId, getPremiumRecipeDetail } from '../components/mockPremiumData';

interface PremiumRecipeDetailPageProps {
  params: Promise<{ recipeId: string }>;
}

export default async function PremiumRecipeDetailPage({ params }: PremiumRecipeDetailPageProps) {
  const { recipeId } = await params;
  const recipe = getPremiumRecipeDetail(recipeId);

  if (!recipe) {
    notFound();
  }

  return (
    <main style={{ padding: '2rem', maxWidth: '920px', margin: '0 auto' }}>
      <Link href="/premium">← Volver al board</Link>
      <h1>Premium recipe detail</h1>
      <PremiumRecipeDetailClient recipe={recipe} currentUserId={currentUserId} />
    </main>
  );
}
