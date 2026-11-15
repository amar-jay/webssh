import adapter from "@sveltejs/adapter-cloudflare";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [
    sveltekit({
      adapter: adapter(),
      csp:
        command === "build"
          ? {
              mode: "auto",
              directives: {
                "default-src": ["self"],
                "script-src": ["self", "wasm-unsafe-eval"],
                "style-src": ["self", "unsafe-inline"],
                "connect-src": [
                  "self",
                  "https://tailcat.dev",
                  "https://tc301a.ipn.dev",
                  "https://tc302a.ipn.dev",
                  "https://tc303a.ipn.dev",
                  "https://tc304a.ipn.dev",
                  "wss://tc301a.ipn.dev",
                  "wss://tc302a.ipn.dev",
                  "wss://tc303a.ipn.dev",
                  "wss://tc304a.ipn.dev",
                ],
                "img-src": ["self", "data:", "blob:"],
                "font-src": ["self"],
                "object-src": ["none"],
                "base-uri": ["self"],
                "frame-ancestors": ["none"],
                "form-action": ["self"],
              },
            }
          : undefined,
    }),
  ],
}));
