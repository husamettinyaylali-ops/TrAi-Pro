// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  // Yayın hedefi VPS / Node sunucusu: `npm run build` → `node .output/server/index.mjs`.
  // (Lovable'ın varsayılanı Cloudflare'dir; yerel SQLite ve dosya deposu orada çalışmaz.)
  // inlineDynamicImports: sunucu tek dosyada paketlenir. Bağımlılıkları _libs parçalarına
  // bölmek döngüsel yükleme sırası yüzünden SSR'da "__commonJSMin is not a function"
  // hatası veriyordu. (Seçenek sarmalayıcının tiplerinde yok ama Nitro'ya olduğu gibi iletilir.)
  nitro: { preset: "node-server", inlineDynamicImports: true } as { preset: string },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
