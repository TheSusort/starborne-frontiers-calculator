import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * three.js and the modules built on it may only be reached through `import()` from code that
 * has checked `shipModelsEnabled()`, so a build without `VITE_ARCADE_SHIP_MODELS` never loads
 * them. Only these modules may import three, or one another, statically.
 */
const LAZY_MODULES = ['shipModelLoader', 'shipSprites', 'ShipModelView', 'shipLighting'];

const SRC = join(__dirname, '..', '..', '..', '..');
const LAZY_DIR = join(SRC, 'components', 'arcade', 'ships');

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

const isLazyModule = (path: string) =>
    LAZY_MODULES.some(
        (m) => path === join(LAZY_DIR, `${m}.ts`) || path === join(LAZY_DIR, `${m}.tsx`)
    );

/** Module specifiers of static `import … from` and `export … from` statements. */
function staticSpecifiers(code: string): string[] {
    return [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map(
        (m) => m[1]
    );
}

describe('ship models stay behind dynamic imports', () => {
    const offenders = sourceFiles(SRC)
        .filter((path) => !isLazyModule(path))
        .flatMap((path) =>
            staticSpecifiers(readFileSync(path, 'utf8'))
                .filter(
                    (spec) =>
                        spec === 'three' ||
                        spec.startsWith('three/') ||
                        LAZY_MODULES.some((m) => spec.endsWith(`/${m}`))
                )
                .map((spec) => `${relative(SRC, path).split(sep).join('/')} -> ${spec}`)
        );

    it('finds the source tree', () => {
        expect(sourceFiles(SRC).some((p) => p.endsWith(join('arcade', 'FlightGame.tsx')))).toBe(
            true
        );
    });

    it('no other module imports three or a ship-model module statically', () => {
        expect(offenders).toEqual([]);
    });

    it('catches a static import when one is present', () => {
        expect(staticSpecifiers("import * as THREE from 'three';")).toEqual(['three']);
        expect(
            staticSpecifiers("import { loadShipModel } from './ships/shipModelLoader';")
        ).toEqual(['./ships/shipModelLoader']);
        expect(staticSpecifiers("const m = import('./ships/shipSprites');")).toEqual([]);
    });
});
