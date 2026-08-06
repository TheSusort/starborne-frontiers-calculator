/**
 * The placement transform: the same subject on the same cells, run by each of the engine's three
 * actor paths. These tests pin the SHAPE of each placement — identical cells, the fragile ally
 * never at index 0, and scenario seeding that follows the subject rather than the player side.
 * Spec: docs/superpowers/specs/2026-08-06-placement-symmetry-oracle-design.md
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    buildScenarioBattle,
    boardFor,
    subjectSideFor,
    FRAGILE_ALLY_HP,
} from '../kitFingerprintScenarios';
import { PLACEMENTS } from '../types';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
import type { BattlePlacement } from '../../../calculators/battleSimulator';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

function subjectShip(name = 'Sentinel'): Ship {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} did not resolve from the corpus`);
    return ship;
}

const positionsOf = (team: BattlePlacement[]): Position[] => team.map((p) => p.position);
const sorted = (xs: Position[]): Position[] => [...xs].sort();

describe('placement transform — board shape', () => {
    beforeAll(requireReferenceData);

    it('subjectSideFor maps the three placements onto two sides', () => {
        expect(subjectSideFor('focus')).toBe('player');
        expect(subjectSideFor('team')).toBe('player');
        expect(subjectSideFor('enemy')).toBe('enemy');
    });

    it('places the subject on the same cell in all three placements', () => {
        const subject = subjectShip();
        const cell = boardFor('plain').focus;
        for (const placement of PLACEMENTS) {
            const input = buildScenarioBattle(subject, 'plain', placement);
            const team = placement === 'enemy' ? input.enemyTeam : input.playerTeam;
            const found = team.find((p) => p.ship.name === subject.name);
            expect(found, `subject missing in ${placement}`).toBeDefined();
            expect(found?.position, `subject moved in ${placement}`).toBe(cell);
        }
    });

    it('uses the identical set of eight cells in all three placements', () => {
        const subject = subjectShip();
        const board = boardFor('plain');
        const expectedSubjectSide = sorted([board.focus, ...board.allies]);
        const expectedOtherSide = sorted([...board.enemies]);

        for (const placement of PLACEMENTS) {
            const input = buildScenarioBattle(subject, 'plain', placement);
            const subjectSide = placement === 'enemy' ? input.enemyTeam : input.playerTeam;
            const otherSide = placement === 'enemy' ? input.playerTeam : input.enemyTeam;
            expect(sorted(positionsOf(subjectSide))).toEqual(expectedSubjectSide);
            expect(sorted(positionsOf(otherSide))).toEqual(expectedOtherSide);
        }
    });

    it('gives the subject the attacker slot ONLY in the focus placement', () => {
        const subject = subjectShip();
        expect(buildScenarioBattle(subject, 'plain', 'focus').playerTeam[0].ship.name).toBe(
            subject.name
        );
        expect(buildScenarioBattle(subject, 'plain', 'team').playerTeam[0].ship.name).not.toBe(
            subject.name
        );
        // In `enemy` the subject is on the other side entirely, so playerTeam[0] is a filler.
        expect(buildScenarioBattle(subject, 'plain', 'enemy').playerTeam[0].ship.name).not.toBe(
            subject.name
        );
    });

    it('never makes the fragile 1-HP ally the attacker focus', () => {
        const subject = subjectShip();
        for (const placement of PLACEMENTS) {
            const input = buildScenarioBattle(subject, 'wounded', placement);
            expect(
                input.playerTeam[0].statOverrides?.hp,
                `fragile ally became the focus in ${placement}`
            ).not.toBe(FRAGILE_ALLY_HP);
        }
    });

    it('keeps the fragile ally on the first ally cell in every placement', () => {
        const subject = subjectShip();
        const fragileCell = boardFor('wounded').allies[0];
        for (const placement of PLACEMENTS) {
            const input = buildScenarioBattle(subject, 'wounded', placement);
            const all = [...input.playerTeam, ...input.enemyTeam];
            const fragile = all.filter((p) => p.statOverrides?.hp === FRAGILE_ALLY_HP);
            expect(fragile, `wrong fragile count in ${placement}`).toHaveLength(1);
            expect(fragile[0].position).toBe(fragileCell);
        }
    });

    it('omitting the placement argument is byte-identical to focus', () => {
        for (const name of loadShipSkillRecords()
            .slice(0, 12)
            .map((r) => r.name)) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            for (const scenario of ['plain', 'richEnemy', 'wounded'] as const) {
                const legacy = buildScenarioBattle(ship, scenario);
                const explicit = buildScenarioBattle(ship, scenario, 'focus');
                // __testTapActors is a fresh closure each call and can't be compared by value.
                const strip = (i: ReturnType<typeof buildScenarioBattle>) => ({
                    ...i,
                    __testTapActors: undefined,
                });
                expect(strip(legacy)).toEqual(strip(explicit));
            }
        }
    });
});
