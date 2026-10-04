/**
 * Tripwire: every place the engine creates a DoT entry or a pending Bomb stamps `appliedSeq` from
 * `StatusEngine.nextAppliedSeq`. Cleanse and duration cuts order DoT stacks against named debuffs
 * by that stamp (newest first, owner ruling 2026-10-04); an unstamped entry would read as older
 * than every named debuff and be cleansed last, silently.
 *
 * Static: scans the combat sources for an object literal pushed onto one of the four DoT
 * containers and requires the literal to carry `appliedSeq`. A new push site without it fails
 * here. The scan is proven able to fail by the NON-VACUITY arm below.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const COMBAT_DIR = join(__dirname, '..');
const PUSH = /(corrosionEntries|infernoEntries|genericDoTEntries|pendingBombs)\)?\.push\(\{/g;

/** Every DoT-container push literal in `source`, as `{ at, literal }`. */
const pushLiterals = (source: string): { at: number; literal: string }[] => {
    const out: { at: number; literal: string }[] = [];
    for (const m of source.matchAll(PUSH)) {
        const start = (m.index ?? 0) + m[0].length - 1;
        let depth = 0;
        let end = start;
        for (let i = start; i < source.length; i++) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        out.push({
            at: source.slice(0, start).split('\n').length,
            literal: source.slice(start, end + 1),
        });
    }
    return out;
};

describe('every DoT entry the engine creates is stamped with appliedSeq', () => {
    const files = readdirSync(COMBAT_DIR).filter(
        (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')
    );

    it('finds the push sites (non-vacuity: the scan sees the known producers)', () => {
        const found = files.flatMap((f) =>
            pushLiterals(readFileSync(join(COMBAT_DIR, f), 'utf8')).map(() => f)
        );
        expect(new Set(found)).toEqual(new Set(['playerTurn.ts', 'triggers.ts', 'engine.ts']));
    });

    it('NON-VACUITY: a literal without the stamp is caught', () => {
        const bad = 'x.corrosionEntries.push({ stacks: 1, tier: 3, remainingRounds: 2 });';
        expect(pushLiterals(bad).filter((p) => !p.literal.includes('appliedSeq'))).toHaveLength(1);
    });

    it('every push literal carries appliedSeq', () => {
        const unstamped = files.flatMap((f) =>
            pushLiterals(readFileSync(join(COMBAT_DIR, f), 'utf8'))
                .filter((p) => !p.literal.includes('appliedSeq'))
                .map((p) => `${f}:${p.at}`)
        );
        expect(unstamped).toEqual([]);
    });
});
