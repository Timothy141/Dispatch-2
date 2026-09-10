import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    server: {
      // node:sqlite is a Node builtin that Vite's module graph does not yet know about.
      deps: { external: [/^node:sqlite$/, /^sqlite$/] },
    },
  },
});
