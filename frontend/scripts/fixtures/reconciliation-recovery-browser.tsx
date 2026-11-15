import { createRoot } from 'react-dom/client';
import CookingSessionPanel from '../../src/app/recipes/CookingSessionPanel';

createRoot(document.getElementById('root')!).render(
  <CookingSessionPanel recipeId="recipe-1" versionId="version-1" />
);
