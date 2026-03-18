/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        'tw-bg': '#15202b',
        'tw-surface': '#192734',
        'tw-border': '#38444d',
        'tw-text': '#e7e9ea',
        'tw-text-secondary': '#8b98a5',
        'tw-accent': '#1d9bf0',
        'tw-accent-hover': '#1a8cd8',
        'tw-danger': '#f4212e',
        'tw-danger-hover': '#dc1d29',
      },
    },
  },
  plugins: [],
};
