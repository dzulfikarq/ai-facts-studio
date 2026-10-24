import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "HOST", "PORT"]);
  const host = env.HOST || "127.0.0.1";
  const apiPort = env.PORT || "3001";
  return {
    plugins: [react()],
    server: {
      host,
      port: Number(env.VITE_PORT || 5173),
      proxy: { "/api": `http://${host}:${apiPort}` },
    },
  };
});
