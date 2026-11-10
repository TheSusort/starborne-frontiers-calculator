import { describe, it, expect, beforeAll } from 'vitest';
import { buildTeam } from '../buildTeam';
import { simulateBattle } from '../../calculators/battleSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { referenceShip } from '../../ship/referenceShip';
import { bossShip } from '../../../constants/bountyBosses';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});

const deps = { getGearPiece: () => undefined, getEngineeringStatsForShipType: () => undefined };

const reference = (name: string) => {
    const template = buildTraceShip(name);
    if (!template) throw new Error(`no reference data for ${name}`);
    return referenceShip(template, 'r0', null);
};

const run = () => {
    setupKeyedRng(1);
    const cells: Array<[Position, string]> = [
        ['M1', 'Butcher'],
        ['M2', 'Nuqtu'],
        ['M3', 'Larkspur'],
        ['M4', 'Laika'],
        ['T1', 'Malvex'],
    ];
    const playerBoard: BoardState = {};
    for (const [pos, name] of cells) playerBoard[pos] = { ship: reference(name) };
    const player = buildTeam(playerBoard, deps).map((p) => ({
        ...p,
        // Equal, large defence and HP so every victim differs only by where it stands.
        statOverrides: { ...p.statOverrides, defence: 5000, hp: 50_000_000, attack: 500 },
    }));
    const enemy = buildTeam({ M1: { ship: bossShip('fenri', 32)! } }, deps);
    return simulateBattle({ playerTeam: player, enemyTeam: enemy, rounds: 10 });
};

const FENRI = 'e:boss:fenri:32:0';
const PRESSING_ONSLAUGHT = 'Pressing Onslaught';

describe('Fenri bounty encounter, end to end', () => {
    const result = run();
    const attackEntries = result.combatLog.flatMap((round) =>
        round.turns.flatMap((turn) =>
            turn.entries
                .filter((entry) => entry.kind === 'attack')
                .map((entry) => ({ round: round.round, entry }))
        )
    );
    const fenriAttacks = attackEntries.filter(({ entry }) => entry.actorId === FENRI);

    it('plays all ten rounds with Fenri still standing', () => {
        // A boss that died early would end the fight sooner and leave every later assertion
        // with fewer rounds to read.
        expect(result.outcome.lastRound).toBe(10);
        expect(result.rounds).toHaveLength(10);
        expect(result.rounds[9].ships.find((s) => s.actorId === FENRI)?.alive).toBe(true);
    });

    // Without the passive Fenri's buff list never names Pressing Onslaught.
    it('Fenri carries Pressing Onslaught from the first round on, every round', () => {
        for (const round of result.rounds) {
            const fenri = round.ships.find((s) => s.actorId === FENRI)!;
            expect(fenri.activeBuffs.some((b) => b.includes(PRESSING_ONSLAUGHT))).toBe(true);
        }
    });

    // Without the stacking, each round's hit on the same victim is the same number.
    it('Fenri hits the front ship harder each round while nobody dies', () => {
        const frontHits = fenriAttacks.map(({ entry }) => entry.targets[0].amount!);
        expect(frontHits).toHaveLength(10);
        for (let i = 1; i < frontHits.length; i++) {
            if (i % 3 === 0) continue; // the charged skill rounds scale differently
            expect(frontHits[i]).toBeGreaterThan(frontHits[0]);
        }
    });

    // With single-cell targeting only the front ship would appear; with the line missing its
    // range the cells behind would be absent, and M1 would be reached if the range overshot.
    it('his basic attack hits the front ship in M4 and the two cells behind it, not M1', () => {
        const byPosition = (id: string) => result.roster.find((r) => r.actorId === id)!.position;
        for (const { entry } of fenriAttacks) {
            expect(entry.targets.map((t) => byPosition(t.targetId))).toEqual(['M4', 'M3', 'M2']);
        }
    });

    // If covered cells took full damage the ratio would be 1; if the covered cell were missing
    // there would be no pair to compare. Laika (M4) and Larkspur (M3) share an affinity, a
    // defence and an HP pool, so a non-crit pair differs only by the covered-cell scale.
    it('the primary target takes full damage and the covered cell half', () => {
        const pairs = fenriAttacks
            .map(({ entry }) => entry.targets)
            .filter((t) => !t[0].didCrit && !t[1].didCrit);
        expect(pairs.length).toBeGreaterThan(0);
        for (const [primary, covered] of pairs) {
            expect(primary.amount! / covered.amount!).toBeCloseTo(2, 6);
        }
    });

    // A cell-by-cell walk of the footprint would list Fenri twice for a line that spans M2 and
    // M1; reading the primary only could not be told apart from that without counting.
    it('a player line attack covering both of his hexes strikes him exactly once', () => {
        const playerHits = attackEntries.filter(({ entry }) =>
            entry.targets.some((t) => t.targetId === FENRI)
        );
        expect(playerHits.length).toBeGreaterThan(0);
        for (const { entry } of playerHits) {
            expect(entry.targets.filter((t) => t.targetId === FENRI)).toHaveLength(1);
        }
        // Butcher (Pattern-Line-Range-2) and Nuqtu (front, Pattern-Line-Range-2) both fire at
        // him in the first round.
        const firstRound = playerHits.filter(({ round }) => round === 1);
        const names = new Set(firstRound.map(({ entry }) => entry.actorId));
        expect([...names].some((id) => id.includes('Butcher'))).toBe(true);
        expect([...names].some((id) => id.includes('Nuqtu'))).toBe(true);
    });
});
