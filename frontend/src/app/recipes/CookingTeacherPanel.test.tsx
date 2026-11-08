import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  safeFetch: vi.fn(),
}));

import CookingTeacherPanel, { requestCookingTeacher } from './CookingTeacherPanel';
import { safeFetch } from '@/lib/api';

describe('CookingTeacherPanel', () => {
  it('converts network exceptions into a recoverable error instead of leaving loading active', async () => {
    vi.mocked(safeFetch).mockRejectedValueOnce(new Error('network down'));

    await expect(requestCookingTeacher('session-1', '¿Qué observo?')).resolves.toEqual({
      error: 'No se pudo consultar al profesor. Intentá nuevamente.',
    });
  });

  it('generates unique heading and input IDs for multiple instances', () => {
    const markup = renderToStaticMarkup(
      <>
        <CookingTeacherPanel sessionId="session-1" />
        <CookingTeacherPanel sessionId="session-1" />
      </>
    );
    const headingIds = [...markup.matchAll(/<h3 id="([^"]+)"/g)].map((match) => match[1]);
    const inputIds = [...markup.matchAll(/<input id="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(headingIds).size).toBe(2);
    expect(new Set(inputIds).size).toBe(2);
    expect(headingIds.every((id) => markup.includes(`aria-labelledby="${id}"`))).toBe(true);
  });
});
