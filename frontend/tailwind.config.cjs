/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary-new': '#5274e7',
        dark: '#051425',
        light: '#d0dada',
        white: '#ffffff',
        primary: '#134160',
        secondary: '#2b71ab',
        info: '#4cb2be',
        'accent-1': '#0d4e6d',
        'accent-2': '#217ca6',
        'accent-3': '#9dc2d0',
        success: '#3dd2b0',
        warning: '#f5e48d',
        danger: '#ea4e5e',
      },
    },
  },
  plugins: [],
}