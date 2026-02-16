import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { Buffer } from 'node:buffer';

export default defineConfig(({ mode }) => {
  // Load ALL env vars (including non-VITE_) from .env/.env.local
  const env = loadEnv(mode, process.cwd(), '');

  const pstUser = env.PSTROTATOR_USER || '';
  const pstPass = env.PSTROTATOR_PASS || '';
  const basicAuth =
    pstUser && pstPass
      ? 'Basic ' + Buffer.from(`${pstUser}:${pstPass}`).toString('base64')
      : '';
  const pstTarget = env.VITE_PSTROTATOR_TARGET || 'http://192.168.1.43:50004';
  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true
        },

        // PstRotatorAz (LAN, HTTP)
        '/pstrotator': {
          target: pstTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/pstrotator/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (basicAuth) proxyReq.setHeader('Authorization', basicAuth);
            });
          }
        }
      }
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@components': path.resolve(__dirname, './src/components'),
        '@hooks': path.resolve(__dirname, './src/hooks'),
        '@utils': path.resolve(__dirname, './src/utils'),
        '@styles': path.resolve(__dirname, './src/styles')
      }
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            satellite: ['satellite.js']
          }
        }
      }
    }
  };
});
