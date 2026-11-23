import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LoadErrorNotice from './load-error-notice';

describe('LoadErrorNotice', () => {
  it('renders the supplied message in an accessible alert', () => {
    const message =
      'Tus restricciones cambiaron desde que se creó este menú. Genera uno nuevo para respetarlas.';
    const markup = renderToStaticMarkup(<LoadErrorNotice message={message} />);

    expect(markup).toContain('role="alert"');
    expect(markup).toContain(message);
    expect(markup).toContain('Volver al Inicio');
    expect(markup).not.toContain('Reintentar carga');
  });
  it('offers an explicit retry when the page supplies a read-only reload action', () => {
    const markup = renderToStaticMarkup(
      <LoadErrorNotice message="Servicio no disponible" onRetry={() => {}} />
    );
    expect(markup).toContain('Reintentar carga');
    expect(markup).toContain('no genera otro menú');
  });
});
