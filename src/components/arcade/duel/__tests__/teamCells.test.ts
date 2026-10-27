import { describe, expect, it } from 'vitest';
import { TEAM_FIELD, teamCells } from '../teamCells';

const seeds = Array.from({ length: 200 }, (_, i) => (i * 2654435761) >>> 0);

describe('teamCells', () => {
    it('is the same layout for the same seed', () => {
        for (const seed of seeds.slice(0, 20)) expect(teamCells(seed)).toEqual(teamCells(seed));
    });

    it('puts each side on three distinct cells of the small grid', () => {
        for (const seed of seeds) {
            const { player, enemy } = teamCells(seed);
            for (const side of [player, enemy]) {
                expect(side).toHaveLength(3);
                expect(new Set(side).size).toBe(3);
                for (const cell of side) expect(TEAM_FIELD).toContain(cell);
            }
        }
    });

    it('different seeds give different layouts, and every cell gets used', () => {
        const layouts = new Set(seeds.map((seed) => JSON.stringify(teamCells(seed))));
        expect(layouts.size).toBeGreaterThan(150);
        const used = new Set(seeds.flatMap((seed) => [...teamCells(seed).player]));
        expect(used).toEqual(new Set(TEAM_FIELD));
        // The two sides are drawn separately, not mirrored copies of one draw.
        expect(
            seeds.some((seed) => {
                const { player, enemy } = teamCells(seed);
                return JSON.stringify(player) !== JSON.stringify(enemy);
            })
        ).toBe(true);
    });
});
