import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    // Replaces the old `ignorePatterns`. A bare `ignores` object is a global ignore.
    { ignores: ['dist', 'node_modules', 'src/test-utils'] },

    {
        // Replaces the `--ext ts,tsx` CLI flag, which ESLint 9 removed: flat config decides
        // which files it applies to, so the `lint` script no longer passes one.
        files: ['**/*.{ts,tsx}'],

        extends: [
            js.configs.recommended,
            tseslint.configs.recommendedTypeChecked,
            react.configs.flat.recommended,
            react.configs.flat['jsx-runtime'],
            reactHooks.configs['recommended-latest'],
            importPlugin.flatConfigs.recommended,
            importPlugin.flatConfigs.typescript,
            // Must stay LAST: it turns off the stylistic rules Prettier owns.
            prettier,
        ],

        plugins: {
            'react-refresh': reactRefresh,
        },

        languageOptions: {
            // Replaces `env: { browser: true, es2022: true }` — flat config has no `env`.
            globals: globals.browser,
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true },
                project: ['./tsconfig.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },

        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },

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
            'react/no-danger': 'error',

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
    },

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
    }
);
