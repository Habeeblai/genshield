import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      nodePolyfills({
        protocolImports: true,
        globals: {
          Buffer: true,
          process: true,
        },
      }),
    ],
    build: {
      target: 'esnext',
      rollupOptions: {
        external: (id) => id.startsWith('node:'),
      },
    },
    optimizeDeps: {
      exclude: ['api'],
    },
    define: {
      global: 'window.__app_global',
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
