import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import ViteYaml from "@modyfi/vite-plugin-yaml"
import type { Plugin as VitePlugin } from "vite"
import { defineConfig } from "wxt"
import { z } from "zod"
import {
  createExtensionClientEnvSchema,
  isLocalPackagesEnabled,
  resolveExtensionEnv,
} from "./src/env/shared"

/**
 * Tree-shake zod's bundled locale error maps.
 *
 * zod v4's entry points (`zod`, `zod/v4`, `zod/v4/core`, …) all re-export
 * `export * as locales from "../locales/index.js"`, and that barrel aggregates
 * ALL 50+ language error maps. Rollup cannot tree-shake a namespace re-export,
 * so every entrypoint bundle inlines ~130KB of locale data the extension never
 * uses: errors render via the built-in `config(en())` call the `zod` entry
 * already makes, and nothing in `src` references `z.locales`.
 *
 * This plugin redirects that barrel to a stub that only re-exports `en`, so
 * `z.locales.en` keeps working while the other 52 maps drop out of every
 * bundle (content scripts, background, shared chunks).
 */
function zodLocalesPruner(): VitePlugin {
  const STUB_ID = "\0zod-locales-stub"
  // Resolve the real en locale module from the installed zod package.
  // `createRequire(import.meta.url)` works in this ESM config file regardless
  // of pnpm's symlinked node_modules layout.
  const nodeRequire = createRequire(import.meta.url)
  const EN_MODULE = nodeRequire.resolve("zod/v4/locales/en.js")
  return {
    name: "prune-zod-locales",
    enforce: "pre",
    resolveId(source, importer) {
      // Only intercept the aggregating barrel, never a specific locale file,
      // and only when it is imported from inside the zod package itself.
      if (
        source.endsWith("locales/index.js") &&
        importer &&
        /[\\/]node_modules[\\/]zod([\\/]src)?[\\/]/.test(importer)
      ) {
        return STUB_ID
      }
      return null
    },
    load(id) {
      if (id === STUB_ID) {
        return `import en from ${JSON.stringify(EN_MODULE)};\n\nexport { en };\n`
      }
      return null
    },
  }
}

const WXT_API_KEY_PATTERN = /^WXT_.*API_KEY/
const ALLOWED_BUNDLED_API_KEYS = new Set<string>()
const useLocalPackages = isLocalPackagesEnabled(process.env)
const shouldSkipEnvValidation = process.env.WXT_SKIP_ENV_VALIDATION === "true"
// Root of the read-frog monorepo whose source is aliased in when developing
// with local packages. Defaults to the sibling checkout; override with
// WXT_MONOREPO_PATH to point at a git worktree (relative or absolute).
const monorepoRoot = process.env.WXT_MONOREPO_PATH
  ? path.resolve(process.env.WXT_MONOREPO_PATH)
  : path.resolve(__dirname, "../read-frog-monorepo")

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: "src",
  imports: false,
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  // Chrome only. There are intentionally no per-browser branches in this config:
  // WXT's `browser` is the native `chrome` namespace here, and `wxt build` /
  // `wxt zip` default to the chrome target.
  manifestVersion: 3,
  // WXT top level alias - will be automatically synced to tsconfig.json paths and Vite alias
  alias: useLocalPackages
    ? {
        "@read-frog/definitions": path.resolve(monorepoRoot, "packages/definitions/src"),
      }
    : {},
  manifest: ({ mode }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    // Fixed extension ID for development
    ...(mode === "development" && {
      key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAw2KhiXO2vySZtPu5pNSbyKhYavh8Be7gXmCZt8aJf6tQ/L3JK0qzL+3JSc/o20td3Jw+B2Dcw+EI93NAZr24xKnTNXQiJpuIuHb8xLXD0Ra/HrTVi4TJIhPdESogoG4uL6CD/F3TxfZJ2trX4Bt9cdAw1RGGeU+xU0g+YFfEka4ZUCpFAmTEw9H3/DU+nCp8yGaJWyiVgCTcFe38GZKEPt0iMJkTw956wz/iiafLx0pNG/RaztG9cAPoQOD2+SMFaeQ+b/G4OG17TYhzb09AhNBl6zSJ3jTKHSwuedCFwCce8Q/EchJfQZv71mjAE97bzwvkDYPCLj31Z5FE8HntMwIDAQAB",
    }),
    permissions: [
      "storage",
      "tabs",
      "alarms",
      "cookies",
      "contextMenus",
      "identity",
      "scripting",
      "webNavigation",
    ],
    host_permissions: [
      "*://*/*", // Required for scripting.executeScript in any frame
    ],
    // Allow images/SVGs referenced by content-script UI <img> tags to be loaded
    // from chrome-extension:// URLs on regular pages.
    web_accessible_resources: [
      {
        resources: ["assets/*.png", "assets/*.svg", "assets/*.webp"],
        matches: ["*://*/*", "file:///*"],
      },
    ],
  }),
  zip: {
    includeSources: ["**/*", ".env.production"],
    excludeSources: ["docs/**/*", "assets/**/*", "repos/**/*", "readmes/**/*"],
  },
  hooks: {
    "vite:build:extendConfig": (entrypoints, viteConfig) => {
      const entrypoint = entrypoints.length === 1 ? entrypoints[0] : undefined
      if (entrypoint?.type !== "content-script") return

      const output = viteConfig.build?.rollupOptions?.output
      if (!output) return

      for (const outputOptions of Array.isArray(output) ? output : [output]) {
        outputOptions.assetFileNames = (assetInfo) =>
          assetInfo.names.some((name) => name.endsWith(".css"))
            ? `content-scripts/${entrypoint.name}.[ext]`
            : "assets/[name]-[hash].[ext]"
      }
    },
  },
  dev: {
    server: {
      // Prefer 3333 over WXT's default 3000 while still allowing WXT to pick
      // another open port when 3333 is already taken.
      port: 3333,
      strictPort: false,
    },
  },
  vite: (configEnv) => ({
    build: {
      // Vite's module-preload helper exists to serve document-based lazy
      // loading: it injects <link rel=modulepreload> into the DOM and reports
      // failures via `window.dispatchEvent`. That machinery is meaningless and
      // hazardous in extension bundles (the service worker has no DOM at all,
      // and dynamic imports are statically inlined by the iife content-script
      // builds), so turn it off — lazy routes in popup/options still work as
      // plain `import()`, just without preloading.
      modulePreload: false,
    },
    resolve: {
      alias: {
        // react-simple-code-editor ships only a CJS build whose
        // `exports.default = Editor` + `__esModule` shape trips rolldown's
        // node-mode CJS interop: the default import resolves to the whole
        // exports object, which React then rejects with error #130
        // ("element type is invalid: got object"). Aliasing to the package's
        // bundled TS source sidesteps the interop entirely.
        "react-simple-code-editor": "react-simple-code-editor/src/index.tsx",
      },
    },
    plugins: [
      // Prune zod's 50+ bundled locale error maps down to `en` (see function
      // comment for details). Must run before Vite's default resolver.
      zodLocalesPruner(),
      // Lets the runtime i18next facade (src/utils/i18n) `import` the `src/locales/*.yml`
      // files as JS objects so i18next can bundle them for runtime language switching.
      //
      // This does NOT replace `@wxt-dev/i18n/module` (still registered in `modules` above).
      // That module reads the same .yml files via its own fs-based mechanism — a separate
      // path from this Vite `import` — and is kept ONLY for two build-time jobs it still owns:
      //   1. Emitting `_locales/*/messages.json`, which the browser uses to localize the
      //      manifest `__MSG_extName__` / `__MSG_extDescription__` below. That is chosen by
      //      the browser UI language at load time and is NOT runtime-switchable (platform
      //      constraint), so it stays with @wxt-dev/i18n.
      //   2. Generating the `#i18n` key types (.wxt/i18n/structure.d.ts) that the facade
      //      reuses for autocomplete/type-checking at every `i18n.t('key')` call site.
      // Runtime UI string lookup itself no longer goes through @wxt-dev/i18n.
      ViteYaml(),
      ...(configEnv.mode === "production"
        ? [
            {
              name: "check-api-key-env",
              buildStart() {
                z.object(
                  createExtensionClientEnvSchema(
                    configEnv.mode === "production",
                    shouldSkipEnvValidation,
                  ),
                ).parse(resolveExtensionEnv(process.env))

                const apiKeyVars = Object.keys(process.env)
                  .filter((key) => WXT_API_KEY_PATTERN.test(key))
                  .filter((key) => !ALLOWED_BUNDLED_API_KEYS.has(key))

                if (apiKeyVars.length > 0) {
                  throw new Error(
                    `\n\nFound WXT_*_API_KEY environment variables that may be bundled:\n` +
                      `${apiKeyVars.map((k) => `   - ${k}`).join("\n")}\n\n` +
                      `Please unset these variables before building for production.\n`,
                  )
                }
              },
            },
          ]
        : []),
    ],
  }),
})
