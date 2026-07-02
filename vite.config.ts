import { defineConfig } from "vite";

// The launcher is a tiny static page bundled into `dist/`, which Capacitor
// ships as the app's start page (`webDir: "dist"`).
export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
