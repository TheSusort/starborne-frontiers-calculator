module.exports = {
    root: true,
    env: {
        browser: true,
        es2022: true,
    },
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended-type-checked',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        'plugin:react-hooks/recommended',
        'plugin:import/recommended',
        'plugin:import/typescript',
        'prettier',
    ],
    ignorePatterns: ['dist', 'node_modules', 'src/test-utils'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: ['./tsconfig.json'],
    },
    plugins: ['react', 'react-hooks', 'react-refresh', '@typescript-eslint', 'import'],
    settings: {
        react: { version: 'detect' },
        'import/resolver': {
            typescript: true,
            node: true,
        },
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

        // Type-aware rules — catch real bugs (warn for now, upgrade to error incrementally)
        '@typescript-eslint/no-floating-promises': 'warn',
        '@typescript-eslint/no-misused-promises': 'warn',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-unsafe-argument': 'warn',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-enum-comparison': 'off',
        '@typescript-eslint/no-redundant-type-constituents': 'off',
        '@typescript-eslint/no-base-to-string': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/unbound-method': 'off',

        // Import rules
        'import/no-cycle': 'warn',
        'import/no-unresolved': 'off', // TypeScript handles this
        'import/order': [
            'warn',
            {
                groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                'newlines-between': 'never',
            },
        ],
        'import/no-duplicates': 'warn',
        'import/no-named-as-default-member': 'off',
        'import/no-named-as-default': 'off',

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
