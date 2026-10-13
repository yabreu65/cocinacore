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
  });
});
