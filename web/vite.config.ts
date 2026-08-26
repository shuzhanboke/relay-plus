import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 代理 /api 和 /v1 到后端，避免开发期跨域。
// 生产环境由 Nginx/网关反代后端。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 后端端口：本机 8080 可能被其他进程占用，开发用 18080（与 server/.env 的 PORT 一致）
      // 注意：用 /api/v1 精确前缀，避免把前端路由 /api-keys 等 /api 开头的页面误代理到后端
      '/api/v1': { target: 'http://localhost:18080', changeOrigin: true },
      '/v1': { target: 'http://localhost:18080', changeOrigin: true },
      '/healthz': { target: 'http://localhost:18080', changeOrigin: true },
      // 上传的静态资源（/uploads/...）由后端 serve，开发期同样回源到后端，否则 5173 会按 SPA fallback 返回 index.html，导致收款码等图片预览失败
      '/uploads': { target: 'http://localhost:18080', changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
});
