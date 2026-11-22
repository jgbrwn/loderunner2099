import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tv: resolve(__dirname, 'tv.html'),
        pad: resolve(__dirname, 'pad.html'),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8000,
    allowedHosts: ['loderunner2099.exe.xyz'],
  },
});
