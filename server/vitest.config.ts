import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    teardownTimeout: 20000,
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: true
      }
    },
    maxWorkers: 1,
    minWorkers: 1,
    sequence: {
      concurrent: false,
      hooks: 'list'
    },
    include: ['tests/**/*.test.ts']
  }
});
