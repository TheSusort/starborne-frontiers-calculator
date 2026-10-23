/**
 * Owner rulings on two gear sets, end to end through the real placement path:
 *  - Reflect also reflects splash hits (the wearer need not be the aimed-at ship).
 *  - Boost extends only buffs the wearer casts itself, never a buff another ship gives the wearer.
 */
import { describe, expect, it } from 'vitest';
import {
    entriesOf,
    hitAmounts,
    runForcedBattle,
    type BoardRun,
    type BoardSpec,
    type UnitSpec,
} from '../__testutils__/equipmentBoard';

const unit = (name: string, position: UnitSpec['position'], ...parts: Partial<UnitSpec>[]) =>
    Object.assign({ name, position }, ...parts, {
        stats: Object.assign({}, ...parts.map((p) => p.stats ?? {})),
    }) as UnitSpec;

const IDLE: Partial<UnitSpec> = {
    active: 'This Unit gains <unit-skill>Attack Up I</unit-skill> for 1 turn.',
    target: 'self',
    pattern: 'Pattern-Base-Support',
};

/** An enemy whose circle pattern hits the aimed-at front ship A and the ships next to it. */
const splashBoard = (): BoardSpec => ({
    player: [
        unit('A', 'M4', IDLE),
        unit('N', 'B4', IDLE),
        unit('R', 'M3', { set: { name: 'REFLECT', pieces: 2 } }, IDLE),
    ],
    enemy: [unit('O', 'M4', { pattern: 'Pattern-Circle-Range-1' })],
    rounds: 1,
});

describe('Reflect set: splash hits', () => {
    it('a Reflect wearer next to the aimed-at ship reflects 7% of the splash it takes', () => {
        const run = runForcedBattle(splashBoard(), true);
        const splash = hitAmounts(run, 'O', 'R');
        const reflected = hitAmounts(run, 'R', 'O');
        expect(splash.length).toBeGreaterThan(0);
        expect(reflected).toHaveLength(splash.length);
        expect(reflected[0]).toBeCloseTo(0.07 * splash[0], 6);
    });

    it('a neighbour without the set takes the same splash and reflects nothing', () => {
        const run = runForcedBattle(splashBoard(), true);
        expect(hitAmounts(run, 'O', 'N').length).toBeGreaterThan(0);
        expect(hitAmounts(run, 'N', 'O')).toEqual([]);
        expect(hitAmounts(run, 'A', 'O')).toEqual([]);
    });
});

describe('Boost set: only the wearer own buffs are extended', () => {
    /** A faster ship grants every ally in its circle a 1-turn buff; the other ship idles. */
    const GRANT: Partial<UnitSpec> = {
        stats: { speed: 200 },
        active: 'This Unit grants <unit-skill>Crit Power Up III</unit-skill> for 1 turn.',
        target: 'allies',
        pattern: 'Pattern-Circle-Support-Range-1',
    };
    const BOOST4 = { set: { name: 'BOOST', pieces: 4 } };
    /** The wearer W is given the buff by support S. */
    const receives: BoardSpec = {
        player: [unit('W', 'M4', BOOST4, IDLE), unit('S', 'M3', GRANT)],
        enemy: [unit('O', 'M4', IDLE)],
    };
    /** The wearer W gives the buff to ally A. */
    const casts: BoardSpec = {
        player: [unit('W', 'M3', BOOST4, GRANT), unit('A', 'M4', IDLE)],
        enemy: [unit('O', 'M4', IDLE)],
    };
    const expiries = (r: BoardRun, who: string) =>
        entriesOf(r, 'buff-expired').filter((e) => e.actorId === r.id(who)).length;

    it("a support's 1-turn buff on the wearer expires on schedule", () => {
        const withSet = runForcedBattle(receives, true);
        const without = runForcedBattle(receives, false);
        expect(expiries(without, 'W')).toBeGreaterThan(0);
        expect(expiries(withSet, 'W')).toBe(expiries(without, 'W'));
    });

    it("the wearer's own 1-turn buff on an ally is extended", () => {
        const withSet = runForcedBattle(casts, true);
        const without = runForcedBattle(casts, false);
        expect(expiries(without, 'A')).toBeGreaterThan(0);
        expect(expiries(withSet, 'A')).toBeLessThan(expiries(without, 'A'));
    });
});
