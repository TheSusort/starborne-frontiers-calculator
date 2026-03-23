/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{js,jsx,ts,tsx}', './index.html'],
    theme: {
        extend: {
            screens: {
                '2xl': '1579px',
            },
            fontFamily: {
                secondary: ['Electrolize', 'sans-serif'],
            },
            colors: {
                primary: {
                    DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
                    hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
                },
                dark: {
                    DEFAULT: 'rgb(var(--color-bg) / <alpha-value>)',
                    lighter: 'rgb(var(--color-bg-lighter) / <alpha-value>)',
                    border: 'rgb(var(--color-border) / <alpha-value>)',
                },
                accent: 'rgb(var(--color-accent) / <alpha-value>)',
                'theme-text': {
                    DEFAULT: 'rgb(var(--color-text) / <alpha-value>)',
                    secondary: 'rgb(var(--color-text-secondary) / <alpha-value>)',
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
