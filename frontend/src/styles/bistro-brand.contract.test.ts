import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

function readTsxFiles(dir: string): Array<{ path: string; content: string }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return readTsxFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.tsx') || /\.(test|spec)\.tsx$/.test(entry.name))
      return [];
    return [{ path: path.slice(sourceRoot.length + 1), content: readFileSync(path, 'utf8') }];
  });
}

describe('CocinaCore Bistro design contract', () => {
  it('keeps the shared semantic colors and typography registered', () => {
    const tokens = readFileSync(resolve(sourceRoot, 'styles/tokens.css'), 'utf8');
    const typography = readFileSync(resolve(sourceRoot, 'styles/typography.css'), 'utf8');
    for (const semantic of [
      'page',
      'surface',
      'surface-warm',
      'text-primary',
      'text-secondary',
      'border',
      'action-primary',
      'action-secondary',
      'danger',
      'success',
      'warning',
    ]) {
      expect(tokens, `Missing shared Bistro token ${semantic}`).toContain(
        `--color-bistro-${semantic}:`
      );
    }
    expect(typography).toContain('--font-body: var(--font-manrope)');
    expect(typography).toContain('--font-heading: var(--font-fraunces)');
    expect(typography).toContain(':where(h1, h2, h3, .type-display, .type-heading)');
  });

  it('keeps household navigation on the designated Bistro forest token', () => {
    const tokens = readFileSync(resolve(sourceRoot, 'styles/tokens.css'), 'utf8');
    const shell = readFileSync(resolve(sourceRoot, 'app/components/HouseholdShell.tsx'), 'utf8');

    expect(tokens).toContain('--color-bg-inverse: var(--color-brand-forest)');
    expect(tokens).toContain('--sidebar-background: var(--color-bg-inverse)');
    expect(shell.match(/bg-\[var\(--sidebar-background\)\]/g)).toHaveLength(2);
    expect(shell.match(/bistro-focus-dark/g)).toHaveLength(2);
    expect(shell).toContain('bg-bistro-champagne text-bistro-text-primary');
    expect(shell).toContain('text-bistro-cream hover:bg-white/10 hover:text-white');
  });

  it('prevents reintroducing hardcoded arbitrary hex colors in app and shared UI components', () => {
    const violations = [
      ...readTsxFiles(resolve(sourceRoot, 'app')),
      ...readTsxFiles(resolve(sourceRoot, 'components')),
    ].flatMap((file) => {
      const found = file.content.match(/[a-zA-Z][\w-]*-\[#[\da-fA-F]{3,8}\]/g) ?? [];
      return found.map((color) => `${file.path}: ${color}`);
    });
    expect(violations).toEqual([]);
  });

  it('uses Bistro primary buttons on signup, login and the household dashboard', () => {
    for (const file of [
      'app/(auth)/login/page.tsx',
      'app/(auth)/signup/page.tsx',
      'app/app/page.tsx',
    ]) {
      const source = readFileSync(resolve(sourceRoot, file), 'utf8');
      expect(source, file).toContain('bistro-action-primary');
    }
  });
});
