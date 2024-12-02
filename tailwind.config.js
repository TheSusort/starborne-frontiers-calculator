/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#ec8c37',
          hover: '#f09c4f',
        },
        dark: {
          DEFAULT: '#111827',
          lighter: '#1f2937',
          border: '#374151',
        }
      }
    },
  },
  plugins: [],
}

