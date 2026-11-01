import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', sourcemap: false, rollupOptions: { input: 'game.html' } },
  define: { global: 'globalThis' },
});
