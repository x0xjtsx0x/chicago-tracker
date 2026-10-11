import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: 'public',
  build: { outDir: '../../dist/web', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787', '/cal': 'http://localhost:8787' } },
});
