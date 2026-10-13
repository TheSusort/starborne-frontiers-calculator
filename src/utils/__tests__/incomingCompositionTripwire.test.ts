import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

// Incoming damage reduction is composed in ONE place, `src/utils/damageComposition.ts` (#673).
// This scans every non-test source file for the shapes a hand-rolled copy takes. A hit outside the
// leaf module must be in ALLOWED with the reason it is not an incoming-damage composition.

const SRC = resolve(__dirname, '../..');
const LEAF = 'src/utils/damageComposition.ts';

const PATTERNS: readonly RegExp[] = [
    /100 \/ \(100 -/g,
    /\(1 [+-] [^;\n]*?(?:damageReduction|incomingDamage|[Rr]eduction)[^;\n]*?\/ ?100\)/g,
];

interface Allowed {
    file: string;
    snippet: string;
    reason: string;
}

const ALLOWED: readonly Allowed[] = [
    {
        file: 'src/utils/autogear/statResolution.ts',
        snippet: '100 / (100 -',
        reason: 'The defence curve itself: defence has its own curve and is never capped.',
    },
    {
        file: 'src/utils/autogear/statResolution.ts',
        snippet: '(1 - damageReduction / 100)',
        reason: 'Attacker DPS against the enemy defence-curve reduction, not a victim composition.',
    },
    {
        file: 'src/utils/combat/playerTurn.ts',
        snippet: '(1 - damageReduction / 100)',
        reason: 'The defence-curve term of the hit pipeline; the incoming buff channel is composed by composeIncomingFactor.',
    },
    {
        file: 'src/utils/combat/protectionTransfer.ts',
        snippet: '(1 - reduction/100)',
        reason: 'Doc comment describing a damage-through factor, not computation.',
    },
    {
        file: 'src/pages/calculators/DefenseCalculatorPage.tsx',
        snippet: '(1 - (Damage Reduction / 100)',
        reason: 'Player-facing formula text for the defence-curve EHP, not computation.',
    },
];

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === '__tests__' || name === '__fixtures__') continue;
            out.push(...sourceFiles(full));
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

function hits(): { file: string; snippet: string }[] {
    const found: { file: string; snippet: string }[] = [];
    for (const full of sourceFiles(SRC)) {
        const file = join('src', relative(SRC, full)).split(sep).join('/');
        if (file === LEAF) continue;
        const text = readFileSync(full, 'utf8');
        for (const pattern of PATTERNS) {
            for (const m of text.matchAll(pattern)) found.push({ file, snippet: m[0] });
        }
    }
    return found;
}

describe('incoming damage composition tripwire (#673)', () => {
    it('finds no hand-rolled composition outside the leaf module', () => {
        const unexpected = hits().filter(
            (h) => !ALLOWED.some((a) => a.file === h.file && a.snippet === h.snippet)
        );
        expect(unexpected).toEqual([]);
    });

    it('keeps every allowlist entry live and justified', () => {
        const found = hits();
        for (const a of ALLOWED) {
            expect(a.reason.length).toBeGreaterThan(10);
            expect(
                found.some((h) => h.file === a.file && h.snippet === a.snippet),
                `stale allowlist entry: ${a.file} ${a.snippet}`
            ).toBe(true);
        }
    });
});
