import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: false,
  build: {
    outDir: ".vite-client",
    emptyOutDir: true,
  },
  test: {
    include: ["test/**/*.test.{jsx,tsx}"],
  },
});
