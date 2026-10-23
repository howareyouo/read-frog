/**
 * React→Preact shim for content-script builds. `wxt.config.ts` aliases `react`
 * to this module in content-script Vite configs only — popup/options keep real
 * react-dom. preact/compat covers the React 19 API surface the content scripts
 * use except `<Activity>`, which is patched in from `./activity`.
 */
// Runtime-wise preact/compat's ESM build (`dist/compat.mjs`) has real named
// exports and the bundler only sees that; the `@ts-expect-error`s are needed
// because its type declaration is CJS-style (`export =`), which TS refuses to
// `export *` / default-re-export from.
// @ts-expect-error
export * from "preact/compat"
export { default } from "preact/compat"
export { Activity } from "./activity"
