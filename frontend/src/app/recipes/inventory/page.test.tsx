import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import RecipeInventoryPage from './page';

describe('Bistró inventory initial render', () => {
  it('renders a loading state, not an empty inventory or a fabricated total', () => {
    const html = renderToStaticMarkup(<RecipeInventoryPage />);
    expect(html).toContain('Inventario de ingredientes');
    expect(html).toContain('Cargando inventario...');
    expect(html).not.toContain('Tu despensa está lista para comenzar');
    expect(html).not.toContain('COP 0.00');
  });
  it('keeps the add form and details collapsed with accessible controls and filter labels', () => {
    const html = renderToStaticMarkup(<RecipeInventoryPage />);
    expect(html).toMatch(/aria-expanded="false" aria-controls="inventory-add-panel"/);
    expect(html).toMatch(/id="inventory-add-panel" hidden=""/);
    expect(html).toMatch(/aria-expanded="false" aria-controls="inventory-optional-fields"/);
    expect(html).toContain('Filtros de inventario');
    expect(html).toContain('Buscar ingrediente');
    expect(html).toContain('Cantidad disponible');
    expect(html).toContain('Fecha de vencimiento');
    expect(html).toContain('Se valida como fecha calendario local (AAAA-MM-DD)');
  });
});
