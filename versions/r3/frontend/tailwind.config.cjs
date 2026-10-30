/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-new': '#3d7cce',
        dark: '#051425',
        light: '#a5b7cf',
        white: '#ffffff',
        primary: '#2e5c99',
        secondary: '#2b71ab',
        info: '#cee4ae',
        'accent-1': '#0d4e6d',
        'accent-2': '#217ca6',
        'accent-3': '#a5b7cf',
        success: '#2cb4ad',
        warning: '#f5e48d',
        danger: '#cf483e',
      },
    },
  },
  plugins: [],
}
