import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    exclude: ['node_modules/', '.next/', 'coverage/', 'e2e/', 'playwright-report/'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'html'],
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 60,
        lines: 70,
      },
      exclude: [
        'node_modules/',
        '.next/',
        'out/',
        '**/*.d.ts',
        'public/**',
        '**/*.config.*',
        'coverage/',
        'e2e/',
        'playwright-report/',
      ],
    },
  },
});
