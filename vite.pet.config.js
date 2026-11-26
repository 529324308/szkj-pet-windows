import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// 桌宠与对应平台使用相同的业务通知和员工聊天环境。
const production = process.env.SZKJ_PET_ENV === 'production';
const businessBase = production ? 'https://zjshuzhi.cn:8090' : 'https://zjshuzhi.cn:8084';
const chatBase = production ? 'https://zjshuzhi.cn:1434' : 'https://zjshuzhi.cn:1435';

export default defineConfig({
  root: __dirname,
  plugins: [vue()],
  envFile: false,
  publicDir: false,
  base: './',
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(businessBase),
    'import.meta.env.VITE_BUSINESS_WS_BASE_URL': JSON.stringify(businessBase.replace(/^http/i, 'ws')),
    'import.meta.env.VITE_EMPLOYEE_CHAT_API_BASE_URL': JSON.stringify(`${chatBase}/api`),
    'import.meta.env.VITE_EMPLOYEE_CHAT_WS_BASE_URL': JSON.stringify(chatBase.replace(/^http/i, 'ws')),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    outDir: 'dist-pet',
    emptyOutDir: true,
    target: 'edge109',
    rollupOptions: {
      input: path.resolve(__dirname, 'pet.html'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
