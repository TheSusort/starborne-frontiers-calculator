// Its own module so the entry chunk can read the version without bundling CHANGELOG.
// `npm run release` bumps it together with `changelog.ts`; read `scripts/release.ts`.
export const CURRENT_VERSION = '1.85.0';
