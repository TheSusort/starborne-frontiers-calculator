/**
 * Tripwire: every place the engine creates a DoT entry or a pending Bomb stamps `appliedSeq` from
 * `StatusEngine.nextAppliedSeq`. Cleanse and duration cuts order DoT stacks against named debuffs
 * by that stamp (newest first, owner ruling 2026-10-04); an unstamped entry would read as older
 * than every named debuff and be cleansed last, silently.
 *
 * Static, over the non-test sources under `src/utils`. What it covers:
 *  - `.push({ … })` of an object literal onto a container NAMED `corrosionEntries`,
 *    `infernoEntries`, `genericDoTEntries` or `pendingBombs` (directly or as `(a ?? b).push`): the
 *    literal must carry `appliedSeq`;
 *  - `.push(` or `.unshift(` of anything else onto those names (a variable, a spread): must be on
 *    `NON_LITERAL_ALLOWLIST`, with the reason its entries are already stamped.
 * What it does NOT see: a container reached through another name (an alias such as
 * `const list = actor.corrosionEntries`), `splice` insertion, or a reassignment of the array. A
 * new producer written that way must be stamped by hand. Both arms are proven able to fail by
 * their NON-VACUITY tests.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const UTILS_DIR = join(__dirname, '..', '..');
const CONTAINER = '(corrosionEntries|infernoEntries|genericDoTEntries|pendingBombs)\\)?';
const LITERAL_PUSH = new RegExp(`${CONTAINER}\\.push\\(\\{`, 'g');
const OTHER_PUSH = new RegExp(`${CONTAINER}\\.(push|unshift)\\((?!\\{)`, 'g');

/** Non-literal pushes onto a DoT container, keyed `<path under src/utils>:<the call's text up to
 *  its first newline>`, each with why the entries it adds already carry `appliedSeq`. Empty:
 *  every producer today pushes a literal. */
const NON_LITERAL_ALLOWLIST: Record<string, string> = {};

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory())
            return name === '__tests__' || name === '__testutils__' ? [] : sourceFiles(full);
        return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [full] : [];
    });

/** Every DoT-container push literal in `source`, as `{ at, literal }`. */
const pushLiterals = (source: string): { at: number; literal: string }[] => {
    const out: { at: number; literal: string }[] = [];
    for (const m of source.matchAll(LITERAL_PUSH)) {
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

/** Every non-literal push onto a DoT container in `source`, as the call's text up to its first
 *  newline — the allowlist key's second half. */
const otherPushes = (source: string): string[] =>
    [...source.matchAll(OTHER_PUSH)].map((m) => {
        const from = m.index ?? 0;
        const nl = source.indexOf('\n', from);
        return source.slice(from, nl < 0 ? undefined : nl).trim();
    });

const files = sourceFiles(UTILS_DIR);
const rel = (f: string): string => relative(UTILS_DIR, f);

describe('every DoT entry the engine creates is stamped with appliedSeq', () => {
    it('finds the literal push sites (non-vacuity: the scan sees the known producers)', () => {
        const found = files.flatMap((f) => pushLiterals(readFileSync(f, 'utf8')).map(() => rel(f)));
        expect(new Set(found)).toEqual(
            new Set(['combat/playerTurn.ts', 'combat/triggers.ts', 'combat/engine.ts'])
        );
    });

    it('NON-VACUITY: a literal without the stamp is caught', () => {
        const bad = 'x.corrosionEntries.push({ stacks: 1, tier: 3, remainingRounds: 2 });';
        expect(pushLiterals(bad).filter((p) => !p.literal.includes('appliedSeq'))).toHaveLength(1);
    });

    it('every push literal carries appliedSeq', () => {
        const unstamped = files.flatMap((f) =>
            pushLiterals(readFileSync(f, 'utf8'))
                .filter((p) => !p.literal.includes('appliedSeq'))
                .map((p) => `${rel(f)}:${p.at}`)
        );
        expect(unstamped).toEqual([]);
    });

    it('NON-VACUITY: a pushed variable, a spread and an unshift are each caught', () => {
        const bad = [
            'v.corrosionEntries.push(entry);',
            '(v?.pendingBombs ?? ctx.pendingBombs).push(...bombs);',
            'v.infernoEntries.unshift(e);',
        ].join('\n');
        expect(otherPushes(bad)).toEqual([
            'corrosionEntries.push(entry);',
            'pendingBombs).push(...bombs);',
            'infernoEntries.unshift(e);',
        ]);
    });

    it('every non-literal push onto a DoT container is allowlisted with a reason', () => {
        const unlisted = files.flatMap((f) =>
            otherPushes(readFileSync(f, 'utf8'))
                .map((call) => `${rel(f)}:${call}`)
                .filter((key) => !(key in NON_LITERAL_ALLOWLIST))
        );
        expect(unlisted).toEqual([]);
    });

    it('every allowlist entry still exists and gives a reason', () => {
        const live = new Set(
            files.flatMap((f) =>
                otherPushes(readFileSync(f, 'utf8')).map((call) => `${rel(f)}:${call}`)
            )
        );
        for (const [key, reason] of Object.entries(NON_LITERAL_ALLOWLIST)) {
            expect(live.has(key), `${key} is no longer in the source`).toBe(true);
            expect(reason.trim().length, `${key} has no reason`).toBeGreaterThan(0);
        }
    });
});
