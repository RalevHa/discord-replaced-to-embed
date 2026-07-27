import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: '/admin/' because Express (src/adminApi.js) serves this build's static
// files under /admin. The dev-server proxy lets `npm run dev` here talk to the
// real bot process (npm start, at the repo root) for API calls.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    proxy: {
      '/admin/api': 'http://localhost:3000',
    },
  },
});
