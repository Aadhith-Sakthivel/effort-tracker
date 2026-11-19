import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev`, proxy API calls to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Split heavy libs into their own cached chunks so the app chunk is smaller
        // and vendor code isn't re-downloaded on every app deploy. Match on the
        // package path (not an exact id) so subpaths like react/jsx-runtime and
        // react-dom/client land in the same vendor chunk instead of the app chunk.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (/[\\/]node_modules[\\/](recharts|d3-|victory-|internmap)/.test(id)) return "charts";
          if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) return "motion";
          return undefined;
        },
      },
    },
  },
});
