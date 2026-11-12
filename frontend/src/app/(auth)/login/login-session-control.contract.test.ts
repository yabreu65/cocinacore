import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('CocinaCore Hogar login interaction contract', () => {
  it('does not offer a fake remember-session switch when the API has no such setting', () => {
    const page = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    expect(page).not.toContain('rememberSession');
    expect(page).not.toContain('Recordar sesión');
    expect(page).not.toContain('Próximamente persistencia configurable de sesión');
    expect(page).toContain('¿Olvidaste tu contraseña?');
  });
});
