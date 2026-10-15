import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ProfilePage from './page';

describe('ProfilePage', () => {
  it('disables all profile form controls during the initial loading render', () => {
    const markup = renderToStaticMarkup(<ProfilePage />);
    const fieldsetStart = markup.indexOf('<fieldset disabled="" class="contents">');
    const fieldsetEnd = markup.lastIndexOf('</fieldset>');

    expect(markup).toContain('Cargando perfil...');
    expect(fieldsetStart).toBeGreaterThanOrEqual(0);
    expect(fieldsetEnd).toBeGreaterThan(fieldsetStart);

    const controlsMarkup = markup.slice(fieldsetStart, fieldsetEnd);
    expect(controlsMarkup).toContain('Nombre completo');
    expect(controlsMarkup).toContain('Nivel culinario');
    expect(controlsMarkup).toContain('Guardar perfil culinario');
  });
});
