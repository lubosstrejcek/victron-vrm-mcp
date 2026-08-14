import { defineConfig } from 'vitest/config';

/**
 * Live suite only — spawns the server and hits Victron's public demo tenant
 * over the network (`/auth/loginAsDemo`). Deliberately kept out of
 * vitest.config.ts, and therefore out of `npm test` and CI, so the default run
 * is genuinely offline rather than quietly dependent on VRM being up.
 *
 * Run with `npm run test:live`. A CLI `--exclude` cannot express this: vitest
 * appends that flag to the config's exclude list rather than replacing it.
 */
export default defineConfig({
  test: {
    include: ['tests/live.test.ts'],
    testTimeout: 15_000,
    globals: false,
  },
});
