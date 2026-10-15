/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        chrome: {
          background: 'rgb(var(--chrome-background) / <alpha-value>)',
          surface: 'rgb(var(--chrome-surface) / <alpha-value>)',
          text: 'rgb(var(--chrome-text) / <alpha-value>)',
          secondary: 'rgb(var(--chrome-text-secondary) / <alpha-value>)',
          divider: 'rgb(var(--chrome-divider) / <alpha-value>)',
          border: 'rgb(var(--chrome-border) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}