import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022', sourcemap: false, rollupOptions: { input: { game: 'game.html', queue: 'queue.html' } } },
  define: { global: 'globalThis' },
  // Local dev stands in for the Pages function: /api/relay/* reaches the relayer the same way it does in production.
  server: { proxy: { '/api/rpc': { target: 'https://near-longcon.nearlive.workers.dev', changeOrigin: true }, '/api/relay': { target: 'https://teslas-mac-mini.tail57f771.ts.net', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/relay/, '/longcon-relay') } } },
});
