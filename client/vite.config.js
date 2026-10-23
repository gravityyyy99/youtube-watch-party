import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In dev the React app runs on :5173 and the API/WebSocket server on :4000.
// The proxy makes the browser think they share one origin, exactly like production
// (where Express serves the built files), so the client code never needs a server URL.
const SERVER = process.env.VITE_SERVER_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': SERVER,
      '/socket.io': { target: SERVER, ws: true },
    },
  },
});
