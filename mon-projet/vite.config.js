import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    allowedHosts: [
      ".onrender.com", // autorise tous les sous-domaines Render
    ],
  },
});
