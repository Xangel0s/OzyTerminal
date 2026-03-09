import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const localNodeModules = resolve(rootDir, 'node_modules');

export default defineConfig({
  root: resolve(rootDir),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(rootDir),
      react: resolve(localNodeModules, 'react'),
      'react-dom': resolve(localNodeModules, 'react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: [resolve(rootDir, 'tests/setup/vitest.setup.ts')],
    clearMocks: true,
  },
});