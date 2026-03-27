module.exports = {
    root: true,
    env: {
        browser: true,
        es2022: true,
    },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
        'prettier',
    ],
    ignorePatterns: ['dist', 'node_modules'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
    },
    plugins: ['react', 'react-hooks', 'react-refresh', '@typescript-eslint'],
    settings: {
        react: { version: 'detect' },
    },
    rules: {
        // TypeScript handles these
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': [
            'warn',
            { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],

        // React
        'react/prop-types': 'off',
        'react/display-name': 'off',

        // Vite HMR
        'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

        // Allow explicit any sparingly
        '@typescript-eslint/no-explicit-any': 'warn',

        // Console
        'no-console': ['error', { allow: ['error', 'warn'] }],
    },
    overrides: [
        {
            // Barrel files and context files legitimately export non-components
            files: [
                '**/index.tsx',
                '**/index.ts',
                'src/contexts/**',
                'src/constants/**',
                'src/components/ship/shipDisplayComponents.tsx',
            ],
            rules: {
                'react-refresh/only-export-components': 'off',
            },
        },
    ],
};
