import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import InvitePage from './page';

describe('CocinaCore: invite placeholder token privacy', () => {
  it('does not disclose bearer invitation credentials in page content', () => {
    const html = renderToStaticMarkup(<InvitePage />);
    expect(html).toContain('Invitación a CocinaCore');
    expect(html).toContain('Invitación pendiente');
    expect(html).toContain('Por seguridad');
    expect(html).not.toContain('Token recibido');
    expect(html).not.toContain('break-all');
  });
});
