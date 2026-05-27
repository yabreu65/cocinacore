import { redirect } from 'next/navigation';

export default function LegacyRecipeRatingPage() {
  redirect('/recipes/history');
}
