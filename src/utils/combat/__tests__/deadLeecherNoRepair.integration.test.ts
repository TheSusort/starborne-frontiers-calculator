/**
 * A destroyed ship performs no repair, so its standing damage-dealt leech pays nothing once it is
 * dead — while the DoTs it applied keep ticking (DoTs outlive their applier).
 *
 * Valerian's passive: "repairs 15% of damage dealt to the enemy, including damage from damage over
 * time effects". Ruiner's passive: "inflicts Bomb II on any enemy performing a repair … gains 1
 * stack of Overload when an enemy performs a repair".
 *
 * Board: Valerian (fast, fragile) hits Ruiner in round 1 and lands Corrosion II for 3 turns; Ruiner
 * kills Valerian on its round-1 turn. Corrosion keeps ticking on Ruiner at the start of its round
 * 2 and 3 turns. Heliodor is an inert anchor that keeps Valerian's side alive. Real kits from
 * docs/ship-skills.csv, both mounts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { corpseBattle, type CorpseRun } from './__fixtures__/corpseBoard';

beforeAll(() => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the reference data into this worktree'
        );
    }
});

const HUGE = 1_000_000_000;

const run = (valerianHp: number, mirror: boolean): CorpseRun =>
    corpseBattle(
        [
            { name: 'Valerian', position: 'M4', hp: valerianHp, attack: 5000, speed: 200 },
            { name: 'Heliodor', position: 'B4', hp: HUGE, attack: 0, speed: 1 },
        ],
        [{ name: 'Ruiner', position: 'M4', hp: HUGE, attack: 20_000, speed: 100 }],
        { mirror, rounds: 3 }
    );

describe.each([false, true])('a dead DoT applier does not repair (mirror=%s)', (mirror) => {
    it('Valerian dies in round 1; her Corrosion still ticks on Ruiner, but she repairs nothing', () => {
        const r = run(3000, mirror);
        const valerian = r.idOf('Valerian');
        const ruiner = r.idOf('Ruiner');
        expect(r.deathRound('Valerian')).toBe(1);
        const after = r.rows.filter((x) => x.round > 1);
        // The DoT outlives her: it ticks on Ruiner in rounds 2 and 3.
        const ticks = after.filter(
            (x) =>
                x.entry.kind === 'dot-ticked' &&
                x.entry.actorId === ruiner &&
                x.entry.note?.includes('corrosion')
        );
        expect(ticks.map((x) => x.round)).toEqual([2, 3]);
        // No repair row from the wreck…
        expect(
            after.filter((x) => x.entry.kind === 'heal' && x.entry.actorId === valerian)
        ).toEqual([]);
        // …so Ruiner's on-repair Bomb never lands on the wreck. (His Overload still climbs from
        // Heliodor's own self-repairs, a living ship's repair.)
        expect(
            after.filter(
                (x) =>
                    x.entry.kind === 'dot-applied' &&
                    x.entry.targets.some((t) => t.targetId === valerian)
            )
        ).toEqual([]);
    });

    it('a living Valerian still repairs from her Corrosion ticks, and Ruiner answers it', () => {
        const r = run(HUGE, mirror);
        const valerian = r.idOf('Valerian');
        const ruiner = r.idOf('Ruiner');
        expect(r.deathRound('Valerian')).toBeUndefined();
        // Ruiner's turns open with the Corrosion ticks, so a Valerian repair before Ruiner's own
        // attack row is a tick's leech. Collect the rounds it happens in.
        const tickRepairRounds = new Set<number>();
        for (const lr of r.result.combatLog) {
            for (const t of lr.turns) {
                if (t.actorId !== ruiner) continue;
                const attackAt = t.entries.findIndex((e) => e.kind === 'attack');
                const opening = attackAt < 0 ? t.entries : t.entries.slice(0, attackAt);
                if (opening.some((e) => e.kind === 'heal' && e.actorId === valerian))
                    tickRepairRounds.add(lr.round);
            }
        }
        expect([...tickRepairRounds]).toEqual([1, 2, 3]);
        expect(
            r.rows.some(
                (x) =>
                    x.round > 1 &&
                    x.entry.kind === 'dot-applied' &&
                    x.entry.actorId === ruiner &&
                    x.entry.targets.some((t) => t.targetId === valerian)
            )
        ).toBe(true);
    });
});
