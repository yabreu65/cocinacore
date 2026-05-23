import Link from 'next/link';

import { premiumRecipes } from './components/mockPremiumData';

export default function PremiumBoardPage() {
  return (
    <main style={{ padding: '2rem', maxWidth: '920px', margin: '0 auto' }}>
      <h1>Premium Recipe Board</h1>
      <p>Recetas públicas premium visibles para todos los tenants en modo lectura.</p>
      <ul>
        {premiumRecipes.map((recipe) => (
          <li key={recipe.id}>
            <strong>{recipe.creatorDisplayName ?? 'Creator'}</strong> · score {recipe.eligibilityScore}% ·{' '}
            <Link href={`/premium/${recipe.id}`}>Ver detalle</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
