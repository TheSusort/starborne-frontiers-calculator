/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
    theme: {
        extend: {
            fontFamily: {
                secondary: ['Electrolize', 'sans-serif'],
            },
            colors: {
                primary: {
                    DEFAULT: '#ec8c37',
                    hover: '#f7b06e',
                },
                dark: {
                    DEFAULT: '#111827',
                    lighter: '#1f2937',
                    border: '#374151',
                },
                rarity: {
                    common: '#d1d5db',
                    uncommon: '#a3e635',
                    rare: '#3b82f6',
                    epic: '#a855f7',
                    legendary: '#f59e0b',
                },
                rarityText: {
                    common: '#111827',
                    uncommon: 'rgb(229 231 235)',
                    rare: 'rgb(229 231 235)',
                    epic: 'rgb(229 231 235)',
                    legendary: 'rgb(229 231 235)',
                },
            },
            fontSize: {
                xxs: '0.5rem',
            },
            letterSpacing: {
                tightest: '-0.35em',
            },
        },
    },
    plugins: [],
};
