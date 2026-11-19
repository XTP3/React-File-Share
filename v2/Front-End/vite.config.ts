import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import type { Plugin } from "vite";

function pdfAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("pdfjs-dist/package.json");
  const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
  const pdfPackage = new URL("./", pathToFileURL(manifestPath));

  return {
    name: "fileshare-pdf-assets",
    apply: "build",
    generateBundle() {
      const folders = ["cmaps", "iccs", "standard_fonts", "wasm"];
      const files = ["LICENSE", ...folders.flatMap((folder) =>
        readdirSync(new URL(`${folder}/`, pdfPackage))
          .filter((file) => !file.startsWith("quickjs-eval."))
          .map((file) => `${folder}/${file}`),
      )];
      for (const file of files) {
        this.emitFile({
          type: "asset",
          fileName: `pdfjs/${version}/${file}`,
          source: readFileSync(new URL(file, pdfPackage)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pdfAssets(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "X",
        short_name: "X",
        description: "Your files, beautifully organized.",
        theme_color: "#2983ff",
        background_color: "#101114",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/f\//, /^\/a\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        globIgnores: ["**/node_modules/**/*", "assets/PdfPreview-*", "pdfjs/**/*"],
        runtimeCaching: [],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../Back-End/www", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "^/f(?:/|$)": "http://127.0.0.1:8080",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
