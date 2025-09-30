// vite.config.js
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      ".onrender.com", // autorise tous les sous-domaines ngrok
    ],
  },
});
