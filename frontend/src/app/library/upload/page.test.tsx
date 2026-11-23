import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LibraryUploadPage from './page';

describe('private PDF upload page', () => {
  it('renders an accessible form with the limits and a library return link', () => {
    const markup = renderToStaticMarkup(<LibraryUploadPage />);
    expect(markup).toContain('Título (obligatorio)');
    expect(markup).toContain('Autor (opcional)');
    expect(markup).toContain('accept="application/pdf"');
    expect(markup).toContain('Home 5 PDF');
    expect(markup).toContain('Professional 15 PDF');
    expect(markup).toContain('no se aplica OCR');
    expect(markup).toContain('href="/library"');
    expect(markup).not.toContain('cargado e indexado correctamente');
  });
});
