/**
 * A ship killed by its own turn-start DoT tick resolves the reactions to that death inside its
 * own (skipped) turn, not inside the next ship's turn.
 *
 * Salvation's passive: "When this Unit is destroyed it repairs 60% of its max HP to all allies".
 * Board: Ravager's hit leaves Salvation at 876 HP with Inferno II on her; the tick at the start of
 * her round-1 turn kills her. Her death repair is her own on-death effect, so it still lands — in
 * the turn block that holds her `death` row. Heliodor is an inert ally to receive it. Real kits
 * from docs/ship-skills.csv, both mounts (the player mount puts Salvation on the focus's lethal
 * tick path, the enemy mount on the per-victim one).
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

describe.each([false, true])('a lethal turn-start tick (mirror=%s)', (mirror) => {
    it("Salvation's death repair resolves in her own turn, the block that holds her death", () => {
        const r = corpseBattle(
            [
                { name: 'Salvation', position: 'M4', hp: 7000, attack: 0, speed: 50 },
                { name: 'Heliodor', position: 'B4', hp: HUGE, attack: 0, speed: 1 },
            ],
            [{ name: 'Ravager', position: 'M4', hp: HUGE, attack: 5000, speed: 100 }],
            { mirror, rounds: 2 }
        );
        const salvation = r.idOf('Salvation');
        const death = r.rows.find((x) => x.entry.kind === 'death' && x.entry.actorId === salvation);
        expect(death?.round).toBe(1);
        const repairs = r.rows.filter(
            (x) => x.entry.kind === 'heal' && x.entry.actorId === salvation
        );
        expect(repairs.map((x) => x.block)).toEqual([death!.block]);
        expect(repairs[0].entry.targets.map((t) => t.targetId)).toEqual([r.idOf('Heliodor')]);
    });
});
