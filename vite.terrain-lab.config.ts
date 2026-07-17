import { defineConfig } from "vite";

export default defineConfig({
  root: "tools/terrain-lab",
  base: "/",
  build: {
    outDir: "../../dist-terrain-lab",
    emptyOutDir: true,
  },
  server: {
    port: 5175,
  },
});
