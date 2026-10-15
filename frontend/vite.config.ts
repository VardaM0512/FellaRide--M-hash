import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 5173 is already allowed by the backend's default CORS settings.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
});
