import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecipeReplacementModal } from './RecipeReplacementModal';

describe('accessible recipe replacement dialog', () => {
  it('has dialog semantics and a name for the icon-only close button', () => {
    const html = renderToStaticMarkup(
      <RecipeReplacementModal
        open
        day="Lunes"
        mealType="Almuerzo"
        alternatives={[]}
        onClose={vi.fn()}
        onSelectAlternative={vi.fn()}
        onRegenerateMeal={vi.fn()}
      />
    );
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-label="Cambiar receta del menú"');
    expect(html).toContain('aria-label="Cerrar cambio de receta"');
  });
});
