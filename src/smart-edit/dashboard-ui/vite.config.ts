import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '../../..');

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(projectRoot, 'dist/smart-edit/resources/dashboard'),
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'dashboard.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  },
  base: '/dashboard/'
});
