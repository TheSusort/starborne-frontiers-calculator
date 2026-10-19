import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * three.js and the modules built on it may only be reached through the `import()`s in
 * `arcadeFlags` (`loadShipSprites`, `loadShipModelView`), which reject while models are off, so a
 * build without `VITE_ARCADE_SHIP_MODELS` never loads them. Only these modules may import three,
 * or one another, statically.
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

/**
 * Module specifiers of static `import … from`, `export … from` and side-effect `import '…'`
 * statements, wherever they sit on a line. `import(…)` and `import.meta` are not static imports.
 */
function staticSpecifiers(code: string): string[] {
    return [
        ...code.matchAll(
            /(?:^|[^\w$.])(?:import|export)\s*(?:[^;'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/g
        ),
    ].map((m) => m[1]);
}

const isRestricted = (spec: string) => {
    const bare = spec.replace(/\.(?:tsx?|jsx?|mjs)$/, '');
    return (
        spec === 'three' ||
        spec.startsWith('three/') ||
        LAZY_MODULES.some((m) => bare.endsWith(`/${m}`))
    );
};

describe('ship models stay behind dynamic imports', () => {
    const offenders = sourceFiles(SRC)
        .filter((path) => !isLazyModule(path))
        .flatMap((path) =>
            staticSpecifiers(readFileSync(path, 'utf8'))
                .filter(isRestricted)
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
        expect(staticSpecifiers("import 'three';")).toEqual(['three']);
        expect(staticSpecifiers("import { a } from './ships/shipSprites.ts';")).toEqual([
            './ships/shipSprites.ts',
        ]);
        expect(staticSpecifiers("const x = 1; import { a } from 'three/addons/x.js';")).toEqual([
            'three/addons/x.js',
        ]);
        expect(staticSpecifiers("export * from './ships/ShipModelView';")).toEqual([
            './ships/ShipModelView',
        ]);
        expect(staticSpecifiers("import {\n    a,\n    b,\n} from 'three';")).toEqual(['three']);
        expect(staticSpecifiers("const m = import('./ships/shipSprites');")).toEqual([]);
        expect(staticSpecifiers('const flag = import.meta.env.X;')).toEqual([]);
    });

    it('treats a specifier with an extension like one without', () => {
        expect(isRestricted('./ships/shipSprites.ts')).toBe(true);
        expect(isRestricted('../ships/ShipModelView.tsx')).toBe(true);
        expect(isRestricted('three/examples/jsm/loaders/FBXLoader.js')).toBe(true);
        expect(isRestricted('./ships/shipVisuals')).toBe(false);
    });
});
