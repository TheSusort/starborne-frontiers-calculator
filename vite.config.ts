import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/',
    plugins: [react(), svgr(), tsconfigPaths()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 3000,
        strictPort: true,
        host: true,
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.ts',
        css: true,
        reporters: ['verbose'],
        coverage: {
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: [...(configDefaults.coverage.exclude ?? [])],
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    if (id.includes('plotly') || id.includes('react-plotly')) {
                        return 'plotly';
                    }

                    if (
                        id.includes('node_modules/react') ||
                        id.includes('node_modules/react-dom') ||
                        id.includes('node_modules/react-router-dom')
                    ) {
                        return 'vendor';
                    }

                    if (id.includes('/src/components/ui')) {
                        return 'ui';
                    }

                    if (id.includes('/src/constants/ships')) {
                        return 'ships-data';
                    }

                    if (id.includes('/src/constants/mainStatValues')) {
                        return 'stat-values';
                    }
                },
            },
        },
        chunkSizeWarningLimit: 1000,
    },
});
