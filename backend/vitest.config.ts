import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The isolation suite talks to a real database and applies migrations on
    // the way in, which is slower than a unit test has any right to be.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Both suites share one database; running them in parallel would have them
    // stepping on each other's fixtures.
    fileParallelism: false,
  },
});
