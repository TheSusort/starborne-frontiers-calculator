import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import svgr from 'vite-plugin-svgr';
import tsconfigPaths from 'vite-tsconfig-paths';
import { VitePWA } from 'vite-plugin-pwa';
import PrerenderPlugin from '@prerenderer/rollup-plugin';
import PuppeteerRenderer from '@prerenderer/renderer-puppeteer';

// https://vitejs.dev/config/
export default defineConfig({
    base: '/',
    plugins: [
        react(),
        svgr(),
        tsconfigPaths(),
        VitePWA({
            registerType: 'autoUpdate',
            // Don't generate a manifest — use the existing public/manifest.json
            manifest: false,
            workbox: {
                skipWaiting: true,
                clientsClaim: true,
                // Inject redirect logic before workbox's own handlers
                importScripts: ['sw-redirect.js'],
                // Exclude the imported script from precaching (it has no content hash)
                globIgnores: ['**/node_modules/**/*', 'sw-redirect.js'],
                // Precache all built assets
                globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
                runtimeCaching: [
                    {
                        // Cache-first for static assets (images, fonts, etc.)
                        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'static-assets',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
                            },
                        },
                    },
                    {
                        // Cache-first for Google Fonts stylesheets
                        urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-stylesheets',
                            expiration: {
                                maxEntries: 10,
                                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
                            },
                        },
                    },
                    {
                        // Cache-first for Google Fonts webfont files
                        urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'google-fonts-webfonts',
                            expiration: {
                                maxEntries: 30,
                                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
                            },
                        },
                    },
                    {
                        // Network-first for Supabase API calls
                        urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
                        handler: 'NetworkFirst',
                        options: {
                            cacheName: 'supabase-api',
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 24 * 60 * 60, // 1 day
                            },
                            networkTimeoutSeconds: 10,
                        },
                    },
                    {
                        // Network-first for Cloudinary images (ship/gear icons)
                        urlPattern: /^https:\/\/res\.cloudinary\.com\/.*/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'cloudinary-images',
                            expiration: {
                                maxEntries: 300,
                                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
                            },
                        },
                    },
                ],
            },
        }),
        PrerenderPlugin({
            routes: [
                '/',
                '/ships/index',
                '/implants',
                '/buffs',
                '/shared-encounters',
                '/defense',
                '/damage',
                '/healing',
                '/speed',
                '/damage-deconstruction',
                '/recruitment',
                '/chrono-reaver',
                '/json-diff',
                '/ships',
                '/gear',
                '/autogear',
                '/simulation',
                '/engineering',
                '/loadouts',
                '/encounters',
                '/statistics',
                '/documentation',
                '/ships/lore',
            ],
            renderer: new PuppeteerRenderer({
                renderAfterTime: 3000,
            }),
            postProcess(renderedRoute) {
                // Strip dynamic overlays from prerendered HTML to prevent hydration mismatch
                // (changelog modal, tutorial overlay open due to empty localStorage)
                function stripElement(html: string, startMarker: string): string {
                    const start = html.indexOf(startMarker);
                    if (start === -1) return html;
                    const tagEnd = html.indexOf('>', start);
                    let depth = 1;
                    let pos = tagEnd + 1;
                    while (depth > 0 && pos < html.length) {
                        const nextOpen = html.indexOf('<div', pos);
                        const nextClose = html.indexOf('</div>', pos);
                        if (nextClose === -1) break;
                        if (nextOpen !== -1 && nextOpen < nextClose) {
                            depth++;
                            pos = nextOpen + 4;
                        } else {
                            depth--;
                            pos = nextClose + 6;
                        }
                    }
                    return html.slice(0, tagEnd + 1) + '</div>' + html.slice(pos);
                }

                // Strip modal-root contents (changelog modal)
                renderedRoute.html = stripElement(renderedRoute.html, '<div id="modal-root"');

                // Remove tutorial overlay entirely (not nested in a container we want to keep)
                const tutorialStart = renderedRoute.html.indexOf(
                    '<div class="fixed inset-0 z-[100]'
                );
                if (tutorialStart !== -1) {
                    const tagEnd = renderedRoute.html.indexOf('>', tutorialStart);
                    let depth = 1;
                    let pos = tagEnd + 1;
                    while (depth > 0 && pos < renderedRoute.html.length) {
                        const nextOpen = renderedRoute.html.indexOf('<div', pos);
                        const nextClose = renderedRoute.html.indexOf('</div>', pos);
                        if (nextClose === -1) break;
                        if (nextOpen !== -1 && nextOpen < nextClose) {
                            depth++;
                            pos = nextOpen + 4;
                        } else {
                            depth--;
                            pos = nextClose + 6;
                        }
                    }
                    renderedRoute.html =
                        renderedRoute.html.slice(0, tutorialStart) + renderedRoute.html.slice(pos);
                }

                // Post-process: ensure Helmet meta tags are in the <head>
                // react-helmet-async sometimes fails to flush <head> in headless Puppeteer
                const seoMap: Record<
                    string,
                    { title: string; description: string; keywords: string }
                > = {
                    '/': {
                        title: '',
                        description:
                            'Starborne Planner - Your comprehensive tool for ship management, gear optimization, and battle simulations.',
                        keywords: 'starborne, frontiers, calculator, ships, gear, simulation',
                    },
                    '/ships': {
                        title: 'Ships',
                        description:
                            'Manage and optimize your Starborne Frontiers ships. View ship details, stats, and configurations.',
                        keywords:
                            'starborne ships, ship management, ship stats, ship configurations',
                    },
                    '/gear': {
                        title: 'Gear',
                        description:
                            'Optimize your ship gear and equipment in Starborne Frontiers. Find the best gear combinations for your ships.',
                        keywords: 'ship gear, equipment, gear optimization, ship equipment',
                    },
                    '/simulation': {
                        title: 'Simulation',
                        description:
                            'Simulate ship battles and test different configurations in Starborne Frontiers.',
                        keywords:
                            'battle simulation, ship battles, combat testing, battle configurations',
                    },
                    '/autogear': {
                        title: 'Autogear',
                        description:
                            'Automatically find optimized gear for your ships in Starborne Frontiers.',
                        keywords:
                            'autogear, ship autogear, autogear calculator, ship autogear calculations',
                    },
                    '/engineering': {
                        title: 'Engineering',
                        description: 'Manage engineering stats for Starborne Frontiers.',
                        keywords: 'engineering calculator, ship engineering, engineering stats',
                    },
                    '/loadouts': {
                        title: 'Loadouts',
                        description: 'Create and manage your ship loadouts in Starborne Frontiers.',
                        keywords: 'ship loadouts, ship configurations, battle loadouts, ship setup',
                    },
                    '/encounters': {
                        title: 'Encounters',
                        description: 'Save your encounters in Starborne Frontiers.',
                        keywords: 'encounters, ship encounters, encounter stats',
                    },
                    '/ships/index': {
                        title: 'Ship Database',
                        description:
                            'View and search through the Starborne Frontiers ship database.',
                        keywords: 'ship database, ship stats, ship details, ship information',
                    },
                    '/defense': {
                        title: 'Defense Calculator',
                        description:
                            'Calculate ship defense values and optimize your defensive capabilities in Starborne Frontiers.',
                        keywords:
                            'defense calculator, ship defense, defensive stats, shield calculations',
                    },
                    '/damage': {
                        title: 'DPS Calculator',
                        description:
                            "Calculate and optimize your ship's damage per second (DPS) in Starborne Frontiers.",
                        keywords: 'dps calculator, damage calculation, ship damage, weapon damage',
                    },
                    '/healing': {
                        title: 'Healing Calculator',
                        description:
                            "Calculate and optimize your ship's healing capabilities in Starborne Frontiers.",
                        keywords:
                            'healing calculator, ship healing, repair calculations, support ships',
                    },
                    '/damage-deconstruction': {
                        title: 'Damage Deconstruction',
                        description:
                            'Analyze and break down ship damage calculations in Starborne Frontiers.',
                        keywords: 'damage analysis, damage breakdown, damage calculations',
                    },
                    '/shared-encounters': {
                        title: 'Shared Encounters',
                        description:
                            "View and learn from other players' successful fleet formations for different encounters",
                        keywords: 'starborne, frontiers, shared encounters, fleet formations',
                    },
                    '/implants': {
                        title: 'Implant Database',
                        description:
                            'Browse and search through all available implants in Starborne Frontiers.',
                        keywords: 'starborne, frontiers, implants, database, stats, effects',
                    },
                    '/buffs': {
                        title: 'Effect Index',
                        description:
                            'Browse all buffs, debuffs, and effects in Starborne Frontiers. Search and filter through 155+ game effects.',
                        keywords: 'starborne, frontiers, buffs, debuffs, effects, status effects',
                    },
                    '/documentation': {
                        title: 'Documentation',
                        description: 'Comprehensive guide to using the Starborne Planner tool.',
                        keywords: 'starborne, frontiers, documentation, guide, tutorial',
                    },
                    '/json-diff': {
                        title: 'JSON Diff Calculator',
                        description:
                            'Compare two Starborne Frontiers JSON export files to see differences.',
                        keywords: 'json diff, file comparison, starborne frontiers',
                    },
                    '/recruitment': {
                        title: 'Ship Recruitment Calculator',
                        description:
                            'Calculate the probability of recruiting specific ships from different beacon types in Starborne Frontiers.',
                        keywords: 'ship recruitment, gacha calculator, beacon calculator',
                    },
                    '/speed': {
                        title: 'Speed Calculator',
                        description:
                            'Calculate ship speed with buffs and debuffs in Starborne Frontiers.',
                        keywords: 'speed calculator, ship speed, speed buffs, speed debuffs',
                    },
                    '/chrono-reaver': {
                        title: 'Chrono Reaver Calculator',
                        description:
                            'Simulate Chrono Reaver implant charge mechanics in Starborne Frontiers.',
                        keywords: 'chrono reaver, implant calculator, charge mechanics',
                    },
                    '/statistics': {
                        title: 'Statistics',
                        description:
                            'View comprehensive analytics for your fleet in Starborne Frontiers.',
                        keywords: 'statistics, analytics, fleet stats',
                    },
                    '/ships/lore': {
                        title: 'Ship Lore',
                        description:
                            'Explore the lore and backstories of every ship in Starborne Frontiers. Read bios, quotes, and learn the history behind your fleet.',
                        keywords:
                            'ship lore, ship bios, starborne frontiers lore, ship backstories',
                    },
                };

                const seo = seoMap[renderedRoute.route];
                if (seo) {
                    const siteUrl = 'https://starborneplanner.com';
                    const fullTitle = seo.title
                        ? `${seo.title} | Starborne Planner`
                        : 'Starborne Planner';
                    const canonicalUrl = `${siteUrl}${renderedRoute.route}`;
                    const ogImage = `${siteUrl}/faviconV2.png`;

                    // Remove duplicate/empty title tags from Helmet and replace the original
                    renderedRoute.html = renderedRoute.html
                        .replace(/<title>[^<]*<\/title>/g, '')
                        .replace('</head>', `<title>${fullTitle}</title></head>`);

                    // Remove old meta description/keywords from index.html and Helmet duplicates
                    renderedRoute.html = renderedRoute.html
                        .replace(/<meta name="description"[^>]*>/g, '')
                        .replace(/<meta name="keywords"[^>]*>/g, '')
                        .replace(/<meta property="og:[^>]*>/g, '')
                        .replace(/<meta name="twitter:[^>]*>/g, '')
                        .replace(/<link rel="canonical"[^>]*>/g, '');

                    // Inject clean meta tags
                    const metaTags = [
                        `<meta name="description" content="${seo.description}">`,
                        `<meta name="keywords" content="${seo.keywords}">`,
                        `<link rel="canonical" href="${canonicalUrl}">`,
                        `<meta property="og:type" content="website">`,
                        `<meta property="og:title" content="${fullTitle}">`,
                        `<meta property="og:description" content="${seo.description}">`,
                        `<meta property="og:image" content="${ogImage}">`,
                        `<meta property="og:url" content="${canonicalUrl}">`,
                        `<meta name="twitter:card" content="summary">`,
                        `<meta name="twitter:title" content="${fullTitle}">`,
                        `<meta name="twitter:description" content="${seo.description}">`,
                        `<meta name="twitter:image" content="${ogImage}">`,
                    ].join('\n        ');

                    renderedRoute.html = renderedRoute.html.replace(
                        '</head>',
                        `${metaTags}\n    </head>`
                    );
                }

                return renderedRoute;
            },
        }),
    ],
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
        // Exclude the Playwright e2e workspace — those tests use @playwright/test,
        // not Vitest, and will fail if Vitest tries to execute them.
        exclude: [...configDefaults.exclude, 'e2e/**', '.worktrees/**'],
        coverage: {
            reporter: ['text', 'json', 'html'],
            include: ['src/**/*'],
            exclude: [...(configDefaults.coverage.exclude ?? [])],
        },
    },
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'router-vendor': ['react-router-dom'],
                },
            },
        },
        chunkSizeWarningLimit: 1000,
        sourcemap: true,
    },
});
