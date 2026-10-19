import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages 项目页部署在 /<repo>/ 下，由 CI 注入 VITE_BASE；
  // 本地开发/根域部署时保持 '/'
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5174, strictPort: false },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // Vite 8 / rolldown 要求 manualChunks 为函数
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/.pnpm/three')) {
            return 'three';
          }
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
});
