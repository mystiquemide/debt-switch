import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/",
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, "index.html"),
        app: resolve(__dirname, "app/index.html"),
      },
    },
  },
});
