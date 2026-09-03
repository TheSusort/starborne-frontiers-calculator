/**
 * The real-kit fingerprint scenarios and the two board geometries they run on. These tests pin the
 * SHAPE of each battle (roster, positions, seeded state), the live invariants the primary board's
 * fingerprints depend on — the focus ship is the one being attacked, and it survives all 20 rounds
 * — and the derivation that routes an unreachable ship onto the support-anchor board. The
 * fingerprint snapshots themselves live in
 * src/utils/calculators/__tests__/realKitFingerprints.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    buildScenarioBattle,
    corpusNames,
    darkSlotsOnPrimaryBoard,
    FILLER_HP,
    FILLER_NAMES,
    FOCUS_ACTOR_ID,
    FOCUS_POSITION,
    occupiedCellCount,
    PRIMARY_BOARD,
    ROUNDS,
    SCENARIOS,
    scenariosFor,
    SEED,
    statusRichShipNames,
    SUPPORT_ANCHOR_BOARD,
    type FingerprintScenario,
} from '../kitFingerprintScenarios';
import { fingerprintActorTokens } from '../fingerprint';
import { PLACEMENTS } from '../types';
import { resolveSubjectActorId } from '../placementSymmetry';
import { runSeededBattle } from '../seededBattle';
import { positionTurnRank } from '../../state';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import { parseShipTargeting } from '../../../targetingParser';
import type { Ship } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
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
 *  seed and an ABSOLUTE seed can be told apart. The focus actor also carries a `position`
 *  (default `FOCUS_POSITION`, i.e. PRIMARY_BOARD's focus cell): `seedFor`'s `wounded`/`richEnemy`
 *  taps now identify the subject by (side, position), not by id (Task 4 — only the `focus`
 *  placement mints the 'attacker' id, so a placement-agnostic tap can't key off it). Callers
 *  comparing a tap built for a different board (e.g. SUPPORT_ANCHOR_BOARD) must pass its focus
 *  cell explicitly. */
const fakeRoster = (focusPosition: Position = FOCUS_POSITION) =>
    [
        {
            id: FOCUS_ACTOR_ID,
            side: 'player',
            shieldPool: 0,
            currentHp: 1000,
            stats: { hp: 1000 },
            position: focusPosition,
        },
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
        // The whole layout rationale (see PRIMARY_BOARD's docstring): selectTargets scans from the
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
        // PRIMARY-board scenarios only (SCENARIOS excludes `supportAnchor` by construction — see
        // its docstring): the support-anchor board takes zero incoming damage by design, so
        // asserting `taken > 0` there would be a bug hunt against an accepted limitation, not a
        // coverage extension.
        '%s takes real incoming damage and survives all 20 rounds in every scenario and placement',
        (name) => {
            const ship = buildTraceShip(name);
            expect(ship).not.toBeNull();
            for (const scenario of SCENARIOS) {
                for (const placement of PLACEMENTS) {
                    const result = runSeededBattle(
                        buildScenarioBattle(ship!, scenario, placement),
                        SEED
                    );
                    // `focus` mints the reserved 'attacker' id; `team`/`enemy` don't, so the
                    // subject is resolved by (side, cell) via the roster, same as `seedFor`.
                    const subjectActorId = resolveSubjectActorId(result, scenario, placement);
                    const rows = result.rounds
                        .flatMap((r) => r.ships)
                        .filter((s) => s.actorId === subjectActorId);
                    const taken = rows.reduce((sum, s) => sum + s.damageTaken, 0);
                    expect(
                        taken,
                        `${name}/${scenario}/${placement}: focus took no damage — the enemies are ` +
                            'not resolving onto it, so every on-damaged clause in the corpus is silent'
                    ).toBeGreaterThan(0);
                    expect(
                        rows.every((s) => s.alive),
                        `${name}/${scenario}/${placement}: focus died — its fingerprint is ` +
                            'truncated at the round it fell, so kill timing now leaks into the snapshot'
                    ).toBe(true);
                    expect(result.outcome.lastRound).toBe(ROUNDS);
                }
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

describe('pattern reachability', () => {
    // Replaces a hand-maintained unreachable-ship allow-list. The set of unreachable ships is now
    // DERIVED, so a corpus refresh that makes a new ship unreachable routes it onto the
    // support-anchor board automatically instead of needing a human to notice and extend a list.
    //
    // Both slots are swept, not just `active`. Charged targeting INHERITS active when both charged
    // columns are blank (targetingParser.ts), and all three of today's dark ships have blank
    // charged columns — so the old active-only guard under-reported by half.
    beforeAll(requireReferenceData);

    it('finds the dark slots the primary board cannot reach', () => {
        // Not an allow-list: a pin on the CURRENT corpus, so a data refresh that changes this
        // announces itself in one named diff rather than silently changing which ships run a
        // fourth scenario. Widening it is fine; it must be a deliberate edit.
        const dark = darkSlotsOnPrimaryBoard()
            .map((d) => `${d.name}:${d.slot}`)
            .sort();
        expect(dark).toEqual([
            'Faust:active',
            'Faust:charged',
            'Mender:active',
            'Mender:charged',
            'Refine:active',
            'Refine:charged',
        ]);
    });

    it('every dark slot resolves to occupied cells on the support-anchor board', () => {
        // The guard that makes the derivation safe. A ship dark on BOTH boards would silently run
        // a fourth scenario that observes nothing; this names it instead.
        const stranded: string[] = [];
        for (const { name, slot } of darkSlotsOnPrimaryBoard()) {
            const ship = buildTraceShip(name);
            if (!ship) continue;
            const pattern = parseShipTargeting(ship)?.[slot]?.pattern;
            if (!pattern) continue;
            if (occupiedCellCount(pattern, SUPPORT_ANCHOR_BOARD) === 0) {
                stranded.push(`${name}:${slot}`);
            }
        }
        expect(
            stranded,
            `slot(s) that resolve to ZERO occupied cells on BOTH boards: ${stranded.join(', ')} — ` +
                'the support-anchor geometry does not cover this pattern shape. Either extend that ' +
                'board or add a third one; do NOT leave the ship running a scenario that observes ' +
                'nothing.'
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
            expect(p.statOverrides?.hp).toBe(FILLER_HP);
        }
    });

    it("reuses wounded's seeding verbatim, so ally repairs land instead of overhealing", () => {
        // Load-bearing, not tidiness: Faust and Mender's actives REPAIR allies, and a repair aimed
        // at a full-HP 500,000,000-HP filler is an overheal that may log nothing at all. A
        // plain-seeded support-anchor board would be green, deterministic, and observing nothing.
        // Each roster's focus actor sits on ITS board's own focus cell (the two boards disagree —
        // M1 vs M4) so `isSubject` still resolves the same actor index on both, and the resulting
        // fractions compare like for like.
        const anchorActors = fakeRoster(SUPPORT_ANCHOR_BOARD.focus);
        const woundedActors = fakeRoster(PRIMARY_BOARD.focus);
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

describe('turn-order invariance — why a placement swap cannot reorder turns', () => {
    // orderByTurnPriority (state.ts) is speed DESC -> positionTurnRank -> player-side-first ->
    // input order. The side tiebreak WOULD be a confound for the placement-symmetry oracle: it is
    // deterministic, so unioning over seeds cannot suppress it, and 33 of 147 corpus ships tie a
    // filler's base speed. It is unreachable only because positionTurnRank is injective over
    // positions and every board cell is distinct, so the comparator always returns at the position
    // step. If a future board edit ever put two actors on one cell, this test fails and the oracle's
    // soundness argument fails with it.
    it.each([
        ['primary', PRIMARY_BOARD],
        ['support-anchor', SUPPORT_ANCHOR_BOARD],
    ] as const)('%s board: all eight cells have distinct positionTurnRank', (_name, board) => {
        const cells = [board.focus, ...board.allies, ...board.enemies];
        expect(cells).toHaveLength(8);
        const ranks = cells.map(positionTurnRank);
        expect(new Set(ranks).size).toBe(8);
    });
});

describe('fragile ally is keyed by board position, not array index', () => {
    beforeAll(requireReferenceData);

    it('has no fragile ally in plain, richEnemy or supportAnchor', () => {
        const subject = buildTraceShip('Sentinel');
        if (!subject) throw new Error('Sentinel did not resolve from the corpus');
        for (const scenario of ['plain', 'richEnemy', 'supportAnchor'] as const) {
            const input = buildScenarioBattle(subject, scenario);
            expect(input.playerTeam.filter((p) => p.statOverrides?.hp === 1)).toHaveLength(0);
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// `statusRich` — the status-seeded scenario the exhaustiveness guard in `seedFor` said was
// DEFERRED, not cancelled.
//
// WHY IT EXISTS, measured 2026-09-03: across all 150 committed fingerprints the tokens `steal`,
// `purge` and `cleanse` appeared ZERO times each. Not because those clauses were broken — because
// no scenario ever put a buff on an enemy or a debuff on an ally, so all three fired into nothing.
// 36 corpus ships carry one of them and not one had a golden observing it.
//
// The arm adds two clauses to the filler's active on BOTH sides — a stealable/purgeable self-buff
// and a cleansable debuff on the whole opposing side — which makes it symmetric by construction and
// needs none of `richEnemy`'s placement-relative seeding.
//
// ⚠️ THE ASSERTIONS BELOW ARE THE ARM'S NON-VACUITY WITNESS, one per mechanic. The snapshot moving
// is NOT the test: a `steal` token could appear on Pallas while every purge and cleanse ship still
// showed nothing, and the only symptom would be a snapshot diff someone could `-u` away. Each
// mechanic gets a named ship and an explicit token assertion instead.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('statusRich scenario', () => {
    beforeAll(requireReferenceData);

    /** Corpus display names running the arm (the cached set is UPPERCASED for lookup). */
    const statusRichNames = (): string[] =>
        corpusNames().filter((n) => statusRichShipNames().has(n.toUpperCase()));

    const tokensFor = (name: string, scenario: FingerprintScenario): string[] => {
        const ship = buildTraceShip(name);
        expect(ship, `${name} did not resolve from the corpus`).not.toBeNull();
        const result = runSeededBattle(buildScenarioBattle(ship!, scenario), SEED);
        return fingerprintActorTokens(result, FOCUS_ACTOR_ID);
    };

    it('applies to exactly the ships whose kit CONSUMES a status, derived from the parse', () => {
        // A TRIPWIRE, not a decoration. The set is derived from `buildShipAbilities`, so a parser
        // regression that stopped producing `buff-steal`/`purge`/`cleanse` would silently shrink it
        // to nothing and every assertion built on it would pass vacuously. Pinning the size makes
        // that regression loud. Measured 2026-09-03: 4 steal + 14 purge + 19 cleanse, Tithonus
        // carrying both a purge and a steal.
        const set = statusRichShipNames();

        expect(set.size).toBe(36);
        for (const name of ['PALLAS', 'THRESH', 'TITHONUS', 'MEATSHIELD']) {
            expect(set.has(name), `${name} should carry a steal`).toBe(true);
        }
        for (const name of ['SEFUBA', 'ZEOLITE', 'RHODIUM']) {
            expect(set.has(name), `${name} should carry a purge`).toBe(true);
        }
        for (const name of ['SUSTAINER', 'AEGIS', 'PURIFIER', 'HAYYAN']) {
            expect(set.has(name), `${name} should carry a cleanse`).toBe(true);
        }
        // ...and a ship with none of the three must NOT get the arm, or "applies to the right
        // ships" would be satisfied by applying it to everybody.
        expect(set.has('BEDROCK')).toBe(false);
    });

    it('only the qualifying ships run the arm', () => {
        const pallas = buildTraceShip('Pallas')!;
        const bedrock = buildTraceShip('Bedrock')!;

        expect(scenariosFor(pallas)).toContain('statusRich');
        expect(scenariosFor(bedrock)).not.toContain('statusRich');
        // Every ship still runs the three universal arms, whatever else it gains.
        for (const s of SCENARIOS) expect(scenariosFor(bedrock)).toContain(s);
    });

    it.each([
        ['Pallas', 'steal:charged'],
        ['Thresh', 'steal:charged'],
        ['Tithonus', 'steal:charged'],
    ])('NON-VACUITY (steal): %s produces %s, which no other scenario can', (name, token) => {
        expect(tokensFor(name, 'statusRich')).toContain(token);
        // The point of the arm: the SAME ship on a clean board produces nothing of the kind.
        expect(tokensFor(name, 'plain').some((t) => t.startsWith('steal'))).toBe(false);
    });

    it.each([
        ['Sefuba', 'purge:active'],
        ['Zeolite', 'purge:active'],
        ['Tithonus', 'purge:active'],
    ])('NON-VACUITY (purge): %s produces %s, which no other scenario can', (name, token) => {
        expect(tokensFor(name, 'statusRich')).toContain(token);
        expect(tokensFor(name, 'plain').some((t) => t.startsWith('purge'))).toBe(false);
    });

    it.each([
        ['Sustainer', 'cleanse:active'],
        ['AEGIS', 'cleanse'],
        ['Purifier', 'cleanse'],
        ['Hayyan', 'cleanse'],
        // FUYING IS THE REGRESSION WITNESS for the half-vacuity this arm shipped with first. Her
        // pattern is `Wings-Support-Not-Self`, so her cleanse NEVER touches herself — she is the
        // only ship shape that can tell "the debuff reached the whole side" apart from "the debuff
        // reached the focus". With the filler on `Pattern-Base` she resolved recipients
        // [Jempol, Rookie], scaled count 1, and removed 0. If this row goes red the filler's
        // footprint has collapsed again, and every self-inclusive cleanse above will still pass.
        ['Fuying', 'cleanse'],
    ])('NON-VACUITY (cleanse): %s produces %s, which no other scenario can', (name, token) => {
        expect(tokensFor(name, 'statusRich')).toContain(token);
        expect(tokensFor(name, 'plain').some((t) => t.startsWith('cleanse'))).toBe(false);
    });

    it('NON-VACUITY (reactive purge): Curator needs the filler CHARGED skill to exist', () => {
        // `on-enemy-charged-cast` — no inert filler has a charge skill at all, so this trigger was
        // unraisable and Curator's purge stayed silent even with buffs on the board.
        expect(tokensFor('Curator', 'statusRich').some((x) => x.startsWith('purge'))).toBe(true);
        expect(tokensFor('Curator', 'plain').some((x) => x.startsWith('purge'))).toBe(false);
    });

    it('MEATSHIELD is the deliberate exception: no steal token, per the locked ruling', () => {
        // His clause is "if this Unit has less than 3 stacks of Protection, it steals Protection
        // until it has 3" — and the owner ruled (2026-09-03) that ONLY AN ENEMY STEALING THEM can
        // put him below 3. The statusRich fillers buff and debuff; they do not steal. So he
        // correctly never fires it, and this is NOT a hole to plug: covering it would need a
        // Protection thief on the opposing side, which is a different scenario question.
        expect(statusRichShipNames().has('MEATSHIELD')).toBe(true);
        expect(tokensFor('Meatshield', 'statusRich').some((t) => t.startsWith('steal'))).toBe(
            false
        );
    });

    /**
     * MEASURED RESIDUAL: 30 of the 36 arm-running ships now emit a status-consuming token
     * (18 cleanse, 12 purge, 3 steal). These SIX still do not, and every one has a named cause —
     * pinned here so the number cannot drift silently in either direction. A ship LEAVING this list
     * is good news that should be seen; a ship JOINING it means a clause went quiet.
     *
     *  - MEATSHIELD  — locked ruling (owner, 2026-09-03): only an ENEMY STEALING them can put him
     *                  below 3 Protection stacks, and the statusRich fillers buff/debuff but never
     *                  steal. Correct silence, not a hole.
     *  - FAUST       — passive purge on `on-destroyed`, i.e. it fires when FAUST dies. The focus
     *                  surviving 20 rounds is a hard requirement of this suite, so this is
     *                  unreachable by construction — the same class as the `death` / `cheat-death`
     *                  entries in realKitFingerprints' EXPECTED_KINDS ledger.
     *  - NAYRA       — charged purge gated on `target-repaired-this-round`. The fillers never
     *                  repair, so the condition is never satisfied.
     *  - AMARTYA     — charged purge whose count is `countScaling` on critDamage per 50. MEASURED:
     *                  her base critDamage is 30, so `floor(30/50) = 0` and the purge removes
     *                  nothing even though she does cast the skill. An artefact of the canonical
     *                  (un-geared) placement, NOT a kit defect — and NOT a general blind spot
     *                  either: 33 corpus ships have base critDamage >= 50, so `per: 50` scaling is
     *                  alive in this suite for most of them.
     *
     *  CURATOR and FUYING were on this list and are not any more, and BOTH were defects in the ARM
     *  rather than in their kits — see the filler doc in `kitFingerprintScenarios` for what each
     *  needed. Curator: a filler CHARGED skill, without which `on-enemy-charged-cast` was
     *  unraisable. Fuying: a filler footprint wide enough for an `all-enemies` debuff to reach an
     *  ALLY, without which every self-EXCLUDING cleanse was silently blind.
     */
    it('pins the four ships whose clause is still silent, each for a known reason', () => {
        const STILL_SILENT = ['Amartya', 'Faust', 'Meatshield', 'Nayra'];
        const silent = statusRichNames()
            .filter((name) => {
                const tokens = tokensFor(name, 'statusRich');
                return !tokens.some((t) => ['steal', 'purge', 'cleanse'].includes(t.split(':')[0]));
            })
            .sort();

        expect(silent).toEqual(STILL_SILENT);
    });

    it('presses the focus without killing it — the arm cannot truncate a fingerprint', () => {
        // statusRich presses HARDER than plain (fillers gain Attack Up, the focus carries Defense
        // Down), and it is excluded from the corpus-wide live invariants because it is not in
        // SCENARIOS. So the truncation hazard is guarded HERE: a focus that died early would cut
        // its own fingerprint short and the missing tokens would read as a behaviour change.
        for (const name of ['Pallas', 'Sefuba', 'AEGIS', 'Meatshield']) {
            const ship = buildTraceShip(name)!;
            const result = runSeededBattle(buildScenarioBattle(ship, 'statusRich'), SEED);
            const rows = result.rounds
                .flatMap((r) => r.ships)
                .filter((s) => s.actorId === FOCUS_ACTOR_ID);
            const taken = rows.reduce((sum, s) => sum + s.damageTaken, 0);

            expect(
                rows.every((s) => s.alive),
                `${name} died in statusRich`
            ).toBe(true);
            expect(taken, `${name} took no damage in statusRich`).toBeGreaterThan(0);
            expect(result.outcome.lastRound, `${name} truncated early`).toBe(ROUNDS);
        }
    });

    it('leaves every OTHER scenario byte-identical — the arm is purely additive', () => {
        // The filler swap is gated on `scenario === 'statusRich'`, so no existing arm can move.
        // Asserted rather than assumed, because a leak here would silently rewrite 150 snapshots.
        const pallas = buildTraceShip('Pallas')!;
        for (const s of SCENARIOS) {
            const battle = buildScenarioBattle(pallas, s);
            const actives = [...battle.playerTeam, ...battle.enemyTeam].map(
                (p) => p.ship.activeSkillText
            );
            expect(
                actives.some((t) => t?.includes('Attack Up II')),
                `${s} must not use the statusRich filler`
            ).toBe(false);
        }
        const rich = buildScenarioBattle(pallas, 'statusRich');
        expect(
            [...rich.playerTeam, ...rich.enemyTeam].filter((p) =>
                p.ship.activeSkillText?.includes('Attack Up II')
            ).length,
            'statusRich must use it for every filler on both sides'
        ).toBe(7);
    });
});
