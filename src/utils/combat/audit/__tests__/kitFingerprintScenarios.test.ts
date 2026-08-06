/**
 * The three real-kit fingerprint scenarios. These tests pin the SHAPE of each battle (roster,
 * positions, seeded state) AND the two live invariants the fingerprints depend on — the focus ship
 * is the one being attacked, and it survives all 20 rounds. The fingerprint snapshots themselves
 * live in src/utils/calculators/__tests__/realKitFingerprints.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    buildScenarioBattle,
    corpusNames,
    FILLER_NAMES,
    FOCUS_ACTOR_ID,
    FOCUS_POSITION,
    ROUNDS,
    SCENARIOS,
    SEED,
} from '../kitFingerprintScenarios';
import { runSeededBattle } from '../seededBattle';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { parseShipTargeting } from '../../../targetingParser';
import { resolveCells } from '../../../targeting/resolvePattern';
import type { Ship } from '../../../../types/ship';
import type { CombatActor } from '../../state';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — tests need them to resolve real ship skill text/stats.'
        );
    }
}

/** A stand-in roster for the seeding taps: two max-HP sizes per side so a FRACTION-of-max-HP
 *  seed and an ABSOLUTE seed can be told apart. */
const fakeRoster = () =>
    [
        { id: FOCUS_ACTOR_ID, side: 'player', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
        { id: 'p:ally', side: 'player', shieldPool: 0, currentHp: 4000, stats: { hp: 4000 } },
        { id: 'e:small', side: 'enemy', shieldPool: 0, currentHp: 1000, stats: { hp: 1000 } },
        { id: 'e:big', side: 'enemy', shieldPool: 0, currentHp: 4000, stats: { hp: 4000 } },
    ] as unknown as CombatActor[];

describe('buildScenarioBattle', () => {
    let focus: Ship;

    beforeAll(() => {
        requireReferenceData();
        const m = buildTraceShip('Malvex');
        if (!m) throw new Error('Malvex did not resolve from the corpus');
        focus = m;
    });

    it('exposes exactly three scenarios', () => {
        expect([...SCENARIOS]).toEqual(['plain', 'richEnemy', 'wounded']);
    });

    it('puts the focus ship first on the player side at the focus position', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        expect(battle.playerTeam[0].ship.name).toBe('Malvex');
        expect(battle.playerTeam[0].position).toBe(FOCUS_POSITION);
    });

    it('builds a 4v4 of distinct ships within each side (a repeat is an illegal game state)', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        expect(battle.playerTeam).toHaveLength(4);
        expect(battle.enemyTeam).toHaveLength(4);
        const ids = (side: typeof battle.playerTeam) => side.map((p) => p.ship.id);
        expect(new Set(ids(battle.playerTeam)).size).toBe(4);
        expect(new Set(ids(battle.enemyTeam)).size).toBe(4);
    });

    it('uses distinct board positions across the whole battle', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        const positions = [...battle.playerTeam, ...battle.enemyTeam].map((p) => p.position);
        expect(new Set(positions).size).toBe(positions.length);
    });

    it('puts three enemies in the focus row, behind the focus (the targeting contract)', () => {
        // The whole layout rationale (see FOCUS_POSITION's docstring): selectTargets scans from the
        // caster's own row and takes the front-most column, so enemies sharing the focus's row and
        // sitting behind it resolve onto the FOCUS. Break this and the focus stops taking damage —
        // which is exactly the hole this suite was found to have.
        const battle = buildScenarioBattle(focus, 'plain');
        const row = (p: string) => p[0];
        const col = (p: string) => Number(p.slice(1));
        const focusRow = row(FOCUS_POSITION);
        const sameRow = battle.enemyTeam.filter((p) => row(p.position) === focusRow);
        expect(sameRow).toHaveLength(3);
        for (const p of sameRow) expect(col(p.position)).toBeLessThan(col(FOCUS_POSITION));
        // ...and the odd enemy out shares a row with an ALLY, so an ally can be attacked (and the
        // fragile one killed) without stealing the focus's incoming damage.
        const offRow = battle.enemyTeam.filter((p) => row(p.position) !== focusRow);
        expect(offRow).toHaveLength(1);
        const allyRows = battle.playerTeam.slice(1).map((p) => row(p.position));
        expect(allyRows).toContain(row(offRow[0].position));
    });

    it('scales filler attack to the focus ship rather than using one constant', () => {
        // A fixed attack value either leaves 4047-defence tanks untouched or kills 7.3k-HP
        // attackers; the derivation is what lets every fingerprint be taken at equal pressure.
        const squishy = buildTraceShip('Xiaodao');
        const tank = buildTraceShip('Lionheart');
        expect(squishy).not.toBeNull();
        expect(tank).not.toBeNull();
        const attackOf = (s: Ship) =>
            buildScenarioBattle(s, 'plain').enemyTeam[0].statOverrides!.attack!;
        expect(attackOf(tank!)).toBeGreaterThan(attackOf(squishy!));
    });

    it('plain seeds nothing at all (no tap — the baseline scenario)', () => {
        // plain must leave initial state untouched: it is the scenario where a wrongly-ungated
        // clause shows up, so any seeding here would mask exactly what it exists to reveal.
        expect(buildScenarioBattle(focus, 'plain').__testTapActors).toBeUndefined();
    });

    it('richEnemy seeds an ABSOLUTE, depletable shield pool on enemy actors only', () => {
        const actors = fakeRoster();
        buildScenarioBattle(focus, 'richEnemy').__testTapActors?.(actors);
        const [, ally, small, big] = actors;
        expect(small.shieldPool).toBeGreaterThan(0);
        expect(actors[0].shieldPool).toBe(0);
        expect(ally.shieldPool).toBe(0);
        // Absolute, not a fraction of max HP: the fraction version was 100M against ~1.2k hits and
        // never depleted, so no shield-gated clause ever saw the pool run out.
        expect(big.shieldPool).toBe(small.shieldPool);
        // Small enough to be spent by the focus's own casts (a few hits' worth of its attack).
        expect(small.shieldPool).toBeLessThan(10 * focus.baseStats.attack);
    });

    it('wounded hurts both sides, and hurts the focus least (it is the one under fire)', () => {
        const actors = fakeRoster();
        buildScenarioBattle(focus, 'wounded').__testTapActors?.(actors);
        for (const a of actors) {
            const pct = (100 * a.currentHp) / a.stats.hp;
            expect(pct).toBeGreaterThan(30);
            expect(pct).toBeLessThan(70);
        }
        const pctOf = (a: CombatActor) => (100 * a.currentHp) / a.stats.hp;
        expect(pctOf(actors[0])).toBeGreaterThan(pctOf(actors[1]));
    });

    it('gives filler enough HP to survive, so kill timing cannot churn fingerprints', () => {
        const battle = buildScenarioBattle(focus, 'plain');
        for (const p of battle.enemyTeam) {
            expect(p.statOverrides?.hp).toBeGreaterThan(p.ship.baseStats.hp);
        }
    });

    it('names 7 filler ships, all resolvable from the corpus', () => {
        expect(FILLER_NAMES).toHaveLength(7);
        for (const name of FILLER_NAMES) expect(buildTraceShip(name)).not.toBeNull();
    });
});

describe('live battle invariants', () => {
    // These run real battles, because the two properties every fingerprint rests on are dynamic:
    // the focus must be HIT (or all on-damaged kit is silent) and must SURVIVE (or its fingerprint
    // is truncated at an arbitrary round). Two focus ships: the corpus's thinnest-HP/lowest-defence
    // ship, which is the survival edge case, and a mid-weight one.
    beforeAll(requireReferenceData);

    it.each(['Xiaodao', 'Malvex'])(
        '%s takes real incoming damage and survives all 20 rounds in every scenario',
        (name) => {
            const ship = buildTraceShip(name);
            expect(ship).not.toBeNull();
            for (const scenario of SCENARIOS) {
                const result = runSeededBattle(buildScenarioBattle(ship!, scenario), SEED);
                const rows = result.rounds
                    .flatMap((r) => r.ships)
                    .filter((s) => s.actorId === FOCUS_ACTOR_ID);
                const taken = rows.reduce((sum, s) => sum + s.damageTaken, 0);
                expect(
                    taken,
                    `${name}/${scenario}: focus took no damage — the enemies are not resolving ` +
                        'onto it, so every on-damaged clause in the corpus is silent'
                ).toBeGreaterThan(0);
                expect(
                    rows.every((s) => s.alive),
                    `${name}/${scenario}: focus died — its fingerprint is truncated at the round ` +
                        'it fell, so kill timing now leaks into the snapshot'
                ).toBe(true);
                expect(result.outcome.lastRound).toBe(ROUNDS);
            }
        }
    );

    it('kills the fragile ally in wounded, and nothing else, in any scenario', () => {
        const ship = buildTraceShip('Malvex');
        expect(ship).not.toBeNull();
        for (const scenario of SCENARIOS) {
            const result = runSeededBattle(buildScenarioBattle(ship!, scenario), SEED);
            const last = result.rounds[result.rounds.length - 1];
            const dead = last.ships.filter((s) => !s.alive).map((s) => s.actorId);
            if (scenario === 'wounded') {
                // Exactly one death, and it is the T4 ally (the first filler ally placement).
                expect(dead).toHaveLength(1);
                expect(dead[0]).not.toBe(FOCUS_ACTOR_ID);
                expect(
                    result.roster.find((r) => r.actorId === dead[0])?.position,
                    'the fragile ally must be the one that dies'
                ).toBe('T4');
            } else {
                expect(dead, `${scenario}: nothing may die outside wounded`).toEqual([]);
            }
        }
    });
});

describe('filler inertness guard', () => {
    // Every one of the 147 fingerprint snapshots assumes the filler ships contribute NOTHING. If a
    // data refresh gives one a passive or a charge skill, that assumption breaks and every snapshot
    // moves at once. This test makes that a single, named, explained failure instead.
    const BARE_DAMAGE = /^This Unit deals <unit-damage>\d+% damage<\/unit-damage>\.?$/;

    beforeAll(requireReferenceData);

    it.each(FILLER_NAMES.map((n) => [n] as const))(
        '%s is still inert: no passives, no charge skill, bare damage active',
        (name) => {
            const row = loadShipSkillRecords().find(
                (r) => r.name.toUpperCase() === name.toUpperCase()
            );
            expect(row, `filler ship "${name}" is no longer in the corpus`).toBeDefined();
            expect(
                row!.passives.filter((p) => p && p.trim() !== ''),
                `filler ship "${name}" gained a passive — it can no longer be inert scaffolding. ` +
                    'Swap it for another inert ship (Trydent, Umayl, Xiaodao are spare) and expect ' +
                    'the fingerprint snapshots to move.'
            ).toEqual([]);
            expect(
                row!.charge.trim(),
                `filler ship "${name}" gained a charge skill — same remedy as a new passive.`
            ).toBe('');
            expect(
                row!.active.trim(),
                `filler ship "${name}" gained a non-bare active skill — it can no longer be inert ` +
                    'scaffolding. Swap it for another inert ship (Trydent, Umayl, Xiaodao are spare) ' +
                    'and expect the fingerprint snapshots to move.'
            ).toMatch(BARE_DAMAGE);
        }
    );
});

describe('active pattern reachability from FOCUS_POSITION', () => {
    // FOCUS_POSITION ('M4') is the FRONT column of its row (see that constant's docstring for the
    // whole board rationale), and Line-Support patterns extend FORWARD from the caster. A caster
    // anchored at the front has no cells ahead of it, so those patterns resolve to zero cells —
    // their active skill can never fire from here. This is a FIXTURE limitation (one anchor cell
    // cannot reach every pattern geometry), not an engine bug: measured precisely, it affects
    // exactly these 3 of 147 corpus ships, all Line-Support at different ranges, and all 3 would
    // resolve fine from M2 (one column back). Moving FOCUS_POSITION was considered and rejected
    // (see FOCUS_POSITION's docstring) — it would regenerate all 147 snapshots a third time,
    // risking the hard-won on-damaged tuning (145/147 fixtures), to reach 3 ships.
    const KNOWN_UNREACHABLE: readonly string[] = ['Faust', 'Mender', 'Refine'];

    beforeAll(requireReferenceData);

    /** Occupied cells DERIVED from the real scenario board (not hard-coded), so this guard follows
     *  the layout automatically if it ever changes. Positions don't depend on which ship is the
     *  focus, so any resolvable corpus ship works to build the board. */
    function occupiedCells(): Set<string> {
        const focus = buildTraceShip('Malvex');
        if (!focus) throw new Error('Malvex did not resolve from the corpus');
        const battle = buildScenarioBattle(focus, 'plain');
        return new Set([...battle.playerTeam, ...battle.enemyTeam].map((p) => p.position));
    }

    /** Names of every corpus ship whose ACTIVE targeting pattern, anchored at FOCUS_POSITION,
     *  resolves to zero cells that are actually occupied on the scenario board. Ships whose
     *  targeting can't be parsed/resolved at all (parseShipTargeting/resolveCells can throw for
     *  unrecognized text) are skipped rather than counted either way — this guard is about
     *  geometry reachability, not targeting-text coverage. */
    function unreachableShips(): string[] {
        const occupied = occupiedCells();
        const out: string[] = [];
        for (const name of corpusNames()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            let pattern;
            try {
                pattern = parseShipTargeting(ship)?.active?.pattern;
                if (!pattern) continue;
                const cells = resolveCells(pattern, FOCUS_POSITION);
                if (!cells.some((c) => occupied.has(c.position))) out.push(name);
            } catch {
                continue;
            }
        }
        return out;
    }

    // Both tests below call unreachableShips(), which rebuilds all 147 corpus ships and re-runs
    // parseShipTargeting/resolveCells for each — computed once here (registered AFTER the
    // requireReferenceData beforeAll above, so reference data is guaranteed present first) rather
    // than once per test.
    let unreachable: string[];

    beforeAll(() => {
        unreachable = unreachableShips();
    });

    it('no ship outside the allow-list resolves its active pattern to zero occupied cells', () => {
        const unexpected = unreachable.filter((n) => !KNOWN_UNREACHABLE.includes(n));
        expect(
            unexpected,
            `ship(s) whose active pattern resolves to ZERO occupied cells from FOCUS_POSITION and ` +
                `are not on the allow-list: ${unexpected.join(', ')} — either a board change made ` +
                'a previously-reachable ship go dark, or a new/changed corpus ship has an ' +
                'unreachable pattern. If genuinely unreachable given the front-column geometry, ' +
                'add it to KNOWN_UNREACHABLE with the same reasoning as Faust/Mender/Refine.'
        ).toEqual([]);
    });

    it('every allow-listed ship is STILL unreachable (a board fix must shrink this list, not leave a stale exemption)', () => {
        const unreachableSet = new Set(unreachable);
        const stale = KNOWN_UNREACHABLE.filter((n) => !unreachableSet.has(n));
        expect(
            stale,
            `allow-listed ship(s) that now resolve to a NON-empty set of occupied cells: ` +
                `${stale.join(', ')} — the board (or this ship's pattern) changed and they are ` +
                'reachable again. Remove them from KNOWN_UNREACHABLE rather than leaving a stale ' +
                'exemption.'
        ).toEqual([]);
    });
});

describe('support-anchor board', () => {
    // The second board geometry. Its ONLY job is to give a forward-extending support pattern
    // (Pattern-Line-Support-*) allies to actually reach: those patterns extend toward column 4,
    // so a caster anchored at the front column resolves to zero cells. Anchoring at M1 with allies
    // at M2/M3/M4 covers ranges 1 through 3.
    //
    // The focus takes ZERO incoming damage here and that is unavoidable, not a tuning miss: for a
    // Line-Support caster to have anyone to support, allies must sit forward of it in its own row,
    // which makes one of THEM the front-most player that selectTargets resolves onto. The primary
    // board keeps the on-damaged coverage for these same ships; this board answers only "does the
    // support footprint reach anyone".
    let focus: Ship;

    beforeAll(() => {
        requireReferenceData();
        const m = buildTraceShip('Malvex');
        if (!m) throw new Error('Malvex did not resolve from the corpus');
        focus = m;
    });

    it('anchors the focus at the BACK of the middle row with three allies forward of it', () => {
        const battle = buildScenarioBattle(focus, 'supportAnchor');
        expect(battle.playerTeam[0].position).toBe('M1');
        const allyPositions = battle.playerTeam.slice(1).map((p) => p.position);
        expect(allyPositions).toEqual(['M2', 'M3', 'M4']);
    });

    it('keeps enemies out of the focus row so the support line is all allies', () => {
        // Also keeps the focus's own enemy-directed kit live: its row scan is M -> B -> T, row M
        // holds no enemies, so it finds B4 front-most and reaches all four under an `all` pattern.
        const battle = buildScenarioBattle(focus, 'supportAnchor');
        for (const p of battle.enemyTeam) expect(p.position[0]).not.toBe('M');
        expect(battle.enemyTeam.map((p) => p.position)).toEqual(['B4', 'B3', 'B2', 'T4']);
    });

    it('uses eight distinct cells, like the primary board', () => {
        // An ally and an enemy on the same cell are indistinguishable in position-keyed engine state.
        const battle = buildScenarioBattle(focus, 'supportAnchor');
        const positions = [...battle.playerTeam, ...battle.enemyTeam].map((p) => p.position);
        expect(new Set(positions).size).toBe(positions.length);
        expect(positions).toHaveLength(8);
    });

    it('has NO fragile ally — every support target must survive the window', () => {
        // `wounded` drops ALLY_POSITIONS[0] to 1 HP so it dies and lights on-ally-destroyed
        // clauses. Here a dying support target would make reach flaky, and on-ally-destroyed
        // coverage for these ships already exists on the primary board.
        const battle = buildScenarioBattle(focus, 'supportAnchor');
        for (const p of battle.playerTeam.slice(1)) {
            expect(p.statOverrides?.hp).toBeGreaterThan(p.ship.baseStats.hp);
        }
    });

    it("reuses wounded's seeding verbatim, so ally repairs land instead of overhealing", () => {
        // Load-bearing, not tidiness: Faust and Mender's actives REPAIR allies, and a repair aimed
        // at a full-HP 500,000,000-HP filler is an overheal that may log nothing at all. A
        // plain-seeded support-anchor board would be green, deterministic, and observing nothing.
        const anchorActors = fakeRoster();
        const woundedActors = fakeRoster();
        buildScenarioBattle(focus, 'supportAnchor').__testTapActors?.(anchorActors);
        buildScenarioBattle(focus, 'wounded').__testTapActors?.(woundedActors);
        expect(anchorActors.map((a) => a.currentHp)).toEqual(woundedActors.map((a) => a.currentHp));
    });

    it('leaves the primary board untouched', () => {
        // The whole approach rests on 144 snapshots not moving.
        const battle = buildScenarioBattle(focus, 'plain');
        expect(battle.playerTeam.map((p) => p.position)).toEqual(['M4', 'T4', 'T2', 'B4']);
        expect(battle.enemyTeam.map((p) => p.position)).toEqual(['M3', 'M2', 'M1', 'T3']);
    });

    it('runs a full 20 rounds with nobody dying', () => {
        // The live half of the board contract. Static position assertions cannot show that the
        // battle actually completes: a death among the support targets would silently shrink the
        // footprint mid-battle, and an early end would truncate the fingerprint at an arbitrary
        // round. Note this asserts NOBODY dies, including the focus — there is no fragile ally
        // here, unlike `wounded`.
        const result = runSeededBattle(buildScenarioBattle(focus, 'supportAnchor'), SEED);
        expect(result.outcome.lastRound).toBe(ROUNDS);
        const last = result.rounds[result.rounds.length - 1];
        const dead = last.ships.filter((s) => !s.alive).map((s) => s.actorId);
        expect(dead, 'nothing may die on the support-anchor board').toEqual([]);
    });
});
