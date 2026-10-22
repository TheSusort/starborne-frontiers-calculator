/**
 * A destroyed ship banks no further per-round stacks. LUXX: "Every turn this Unit gains 1 stack of
 * Blast". Mangler: "This Unit gains 1 stack of Overload every turn …". Both are per-round
 * accumulating self grants, banked at the top of every round.
 *
 * Board: Ravager kills LUXX on its round-1 turn; Mangler survives (Ravager's single-target hit never
 * reaches it) and Heliodor is an inert anchor. Real kits from docs/ship-skills.csv, both mounts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { corpseBattle } from './__fixtures__/corpseBoard';

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the reference data into this worktree'
        );
    }
});

const HUGE = 1_000_000_000;

describe.each([false, true])('per-round stacks stop at death (mirror=%s)', (mirror) => {
    const run = () =>
        corpseBattle(
            [
                { name: 'LUXX', position: 'M4', hp: 3000, attack: 0, speed: 50 },
                { name: 'Mangler', position: 'T4', hp: 3000, attack: 0, speed: 50 },
                { name: 'Heliodor', position: 'B4', hp: HUGE, attack: 0, speed: 1 },
            ],
            [{ name: 'Ravager', position: 'M4', hp: HUGE, attack: 50_000, speed: 100 }],
            { mirror, rounds: 3 }
        );
    const gainRounds = (r: ReturnType<typeof run>, name: string, buff: string): number[] =>
        r.rows
            .filter(
                (x) =>
                    x.entry.kind === 'buff' &&
                    x.entry.actorId === r.idOf(name) &&
                    x.entry.note === buff
            )
            .map((x) => x.round);

    it('LUXX gains Blast in round 1, dies to Ravager, and gains nothing after', () => {
        const r = run();
        expect(r.deathRound('Luxx')).toBe(1);
        expect(gainRounds(r, 'Luxx', 'Blast')).toEqual([1]);
    });

    it('a living Mangler keeps gaining Overload every round', () => {
        const r = run();
        expect(r.deathRound('Mangler')).toBeUndefined();
        expect(gainRounds(r, 'Mangler', 'Overload')).toEqual([1, 2, 3]);
    });
});
