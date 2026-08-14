import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    globals: false,
    coverage: {
      // src/index.ts is the stdio/HTTP entry exercised only by the
      // subprocess E2E suites (http, health, tools.coverage, …), which V8
      // coverage cannot see — excluding it keeps thresholds meaningful.
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 72,
        functions: 90,
      },
    },
  },
});
