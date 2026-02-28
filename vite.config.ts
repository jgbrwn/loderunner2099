import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
  server: {
    host: '0.0.0.0',
    port: 8000,
    allowedHosts: ['loderunner2099.exe.xyz'],
  },
});
