import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// In dev, /api (and the WebSocket at /api/v1/ws) is proxied to FastAPI on :8000.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
  host: "0.0.0.0",
  port: 5173,
  allowedHosts: true,
  proxy: {
    "/api": {
      target: "http://localhost:8000",
      changeOrigin: true,
      ws: true
    }
  }
},
});
