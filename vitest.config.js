import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    // ohc-cluster tests use node:test and run via its own `npm test` (node --test)
    exclude: [...configDefaults.exclude, 'ohc-cluster/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'src/test/', '*.config.js', '**/*.d.ts', 'dist/', 'build/'],
    },
  },
});
