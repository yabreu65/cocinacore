import { redirect } from 'next/navigation';

interface PremiumRecipeDetailLegacyPageProps {
  params: Promise<{ recipeId: string }>;
}

export default async function PremiumRecipeDetailLegacyPage({
  params,
}: PremiumRecipeDetailLegacyPageProps) {
  const { recipeId } = await params;
  redirect(`/app/premium/${recipeId}`);
}
