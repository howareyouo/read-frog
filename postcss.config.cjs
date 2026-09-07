module.exports = {
  plugins: {
    // Tailwind v4's ONLY entry point in this project — there is no
    // @tailwindcss/vite, so removing this plugin breaks every `@import
    // "tailwindcss"` in src/assets/styles (build loses all utility styles).
    "@tailwindcss/postcss": {},
    // "postcss-rem-to-responsive-pixel": {
    //   rootValue: 16,
    //   propList: ["*"],
    //   transformUnit: "px",
    // },
  },
}
