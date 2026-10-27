import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["VITE_", "HOST", "PORT"]);
  const host = env.HOST || "127.0.0.1";
  const targetHost = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const apiPort = env.PORT || "3001";
  const vitePort = Number(env.VITE_PORT || 5173);
  return {
    plugins: [react()],
    server: {
      host,
      port: vitePort,
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://${targetHost}:${apiPort}`,
          configure: (proxy) => proxy.on("proxyReq", (proxyRequest) => {
            proxyRequest.setHeader("x-ai-facts-studio-vite-proxy", "vite");
          }),
        },
        "/audio": { target: `http://${targetHost}:${apiPort}` },
        "/visual-assets": { target: `http://${targetHost}:${apiPort}` },
      },
    },
  };
});
