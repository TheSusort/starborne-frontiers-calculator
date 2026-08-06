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
    SEED,
} from '../kitFingerprintScenarios';
import { PLACEMENTS } from '../types';
import { runSeededBattle } from '../seededBattle';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
import type { BattlePlacement, BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { CombatActor } from '../../state';

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

/** A plain snapshot of the fields these tests need, taken the instant seeding runs — NOT a live
 *  `CombatActor` reference. The array `__testTapActors` receives is the engine's own roster, which
 *  the 20-round battle keeps mutating in place after the tap returns (real damage, shield spend),
 *  so reading `.currentHp`/`.shieldPool` off it AFTER `runSeededBattle` resolves would observe the
 *  end-of-battle state, not the seeded one. */
interface ActorSeedSnapshot {
    side: 'player' | 'enemy';
    position?: Position;
    currentHp: number;
    maxHp: number;
    shieldPool: number;
}

/** Runs the battle through `runSeededBattle`, wrapping `__testTapActors` so the real seeding tap
 *  still runs (this must exercise the engine's actual seeding, not a hand-built stand-in), then
 *  snapshots the actors immediately afterward — before combat has a chance to mutate them. */
function capturedSeedSnapshot(input: BattleSimulationInput): ActorSeedSnapshot[] {
    let captured: ActorSeedSnapshot[] = [];
    const original = input.__testTapActors;
    input.__testTapActors = (actors) => {
        original?.(actors);
        captured = actors.map((a) => ({
            side: a.side,
            position: a.position,
            currentHp: a.currentHp,
            maxHp: a.stats.hp,
            shieldPool: a.shieldPool,
        }));
    };
    runSeededBattle(input, SEED);
    return captured;
}

/** Actors that carry a board `position`. One actor in every run — a vestigial enemy-side dummy
 *  used for player-offense DPS accounting (battleSimulator.ts) — legitimately has none, and must
 *  be excluded rather than tripping these assertions. */
const positioned = (actors: ActorSeedSnapshot[]): ActorSeedSnapshot[] =>
    actors.filter((a) => a.position !== undefined);

const hpFraction = (a: ActorSeedSnapshot): number => a.currentHp / a.maxHp;

describe('placement transform — live seeding regression (Finding 1)', () => {
    // These pin the two behaviours Task 4 exists to fix. Both are extensionally equal to the OLD
    // (focus-only) predicates under the default 'focus' placement, so every other test in this
    // suite (and the whole existing corpus) stays green even if either predicate regresses —
    // only a non-'focus' placement can catch it. Verified by hand: reverting
    // `a.side !== subjectSide` to `a.side === 'enemy'` in the `richEnemy` branch, or `isSubject(a)`
    // to `a.id === FOCUS_ACTOR_ID`, fails the corresponding test below.
    beforeAll(requireReferenceData);

    it("enemy placement: 'wounded' seeds the subject actor to 45% HP and fillers to 35%", () => {
        const subject = subjectShip();
        const subjectCell = boardFor('wounded').focus;
        const actors = capturedSeedSnapshot(buildScenarioBattle(subject, 'wounded', 'enemy'));

        const subjectActor = actors.find((a) => a.side === 'enemy' && a.position === subjectCell);
        expect(subjectActor, 'subject actor not found on the enemy side at its cell').toBeDefined();
        expect(hpFraction(subjectActor!)).toBeCloseTo(0.45, 5);

        const fillers = positioned(actors).filter((a) => a !== subjectActor);
        expect(fillers.length).toBeGreaterThan(0);
        for (const filler of fillers) {
            expect(hpFraction(filler)).toBeCloseTo(0.35, 5);
        }
    });

    it("enemy placement: 'richEnemy' zeroes the subject's shieldPool and arms the player fillers", () => {
        const subject = subjectShip();
        const subjectCell = boardFor('richEnemy').focus;
        const actors = capturedSeedSnapshot(buildScenarioBattle(subject, 'richEnemy', 'enemy'));

        const subjectActor = actors.find((a) => a.side === 'enemy' && a.position === subjectCell);
        expect(subjectActor, 'subject actor not found on the enemy side at its cell').toBeDefined();
        expect(subjectActor!.shieldPool).toBe(0);

        const playerFillers = actors.filter((a) => a.side === 'player');
        expect(playerFillers.length).toBeGreaterThan(0);
        for (const filler of playerFillers) {
            expect(filler.shieldPool).toBeGreaterThan(0);
        }
    });

    it("team placement: 'wounded' seeds the subject actor to 45% HP and fillers to 35%", () => {
        const subject = subjectShip();
        const subjectCell = boardFor('wounded').focus;
        const actors = capturedSeedSnapshot(buildScenarioBattle(subject, 'wounded', 'team'));

        const subjectActor = actors.find((a) => a.side === 'player' && a.position === subjectCell);
        expect(
            subjectActor,
            'subject actor not found on the player side at its cell'
        ).toBeDefined();
        expect(hpFraction(subjectActor!)).toBeCloseTo(0.45, 5);

        const fillers = positioned(actors).filter((a) => a !== subjectActor);
        expect(fillers.length).toBeGreaterThan(0);
        for (const filler of fillers) {
            expect(hpFraction(filler)).toBeCloseTo(0.35, 5);
        }
    });

    it("team placement: 'richEnemy' zeroes the subject's own shieldPool and arms the enemy fillers", () => {
        const subject = subjectShip();
        const subjectCell = boardFor('richEnemy').focus;
        const actors = capturedSeedSnapshot(buildScenarioBattle(subject, 'richEnemy', 'team'));

        const subjectActor = actors.find((a) => a.side === 'player' && a.position === subjectCell);
        expect(
            subjectActor,
            'subject actor not found on the player side at its cell'
        ).toBeDefined();
        expect(subjectActor!.shieldPool).toBe(0);

        const enemyFillers = actors.filter((a) => a.side === 'enemy' && a.position !== undefined);
        expect(enemyFillers.length).toBeGreaterThan(0);
        for (const filler of enemyFillers) {
            expect(filler.shieldPool).toBeGreaterThan(0);
        }
    });
});

describe('placement transform — subject match-count guard (Finding 2)', () => {
    // If `isSubject` ever matches zero actors, the 'wounded'/'supportAnchor' tap would otherwise
    // silently degrade to a uniform 35% seed with nothing failing. `focus` is protected by the
    // 147-ship snapshot; `team`/`enemy` have none, so this guard is the only thing standing between
    // a broken predicate and a spurious placement-asymmetry finding that reads like an engine bug.
    beforeAll(requireReferenceData);

    it('throws when no actor matches the expected (side, cell)', () => {
        const subject = subjectShip();
        const tap = buildScenarioBattle(subject, 'wounded', 'enemy').__testTapActors;
        expect(tap).toBeDefined();

        // Deliberately no actor at (side: 'enemy', position: boardFor('wounded').focus).
        const noMatch = [
            { side: 'player', position: 'M4', currentHp: 100, stats: { hp: 100 } },
            { side: 'enemy', position: 'T3', currentHp: 100, stats: { hp: 100 } },
        ] as unknown as CombatActor[];

        expect(() => tap!(noMatch)).toThrow(/expected exactly 1 subject actor/);
    });
});
