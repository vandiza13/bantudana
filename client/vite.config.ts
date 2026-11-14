// Build klien untuk Vercel — Vite (Node.js), pengganti client/build.mjs
// yang memakai Bun.build di paket standalone.
//
// Kenapa Vite: build di Vercel berjalan di Node.js (npm), Bun tidak
// tersedia di sana. Vite adalah build tool standar untuk React di
// Vercel; entry-nya tetap client/index.html dengan
// `<script type="module" src="/src/main.tsx">`, dan plugin
// @tailwindcss/vite memproses theme.css (Tailwind v4) dengan cara yang
// sama seperti bun-plugin-tailwind di paket standalone.
//
//   npm run build   ->  vite build --config client/vite.config.ts
//   output          ->  client/dist/  (dipakai vercel.json outputDirectory)
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    minify: true,
  },
});
